"""
WRF模式气象数据适配器模块
用于城市热岛效应监测与WRF模式气象数据对接
支持温度、风速、湿度、气压等气象参数的处理和分析

功能：
1. WRF模式输出数据解析
2. 气象参数空间插值
3. 热岛强度计算
4. 时序数据提取
5. 与遥感反演数据融合

作者：系统自动生成
版本：1.0.0
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional, Union
from dataclasses import dataclass, field
import logging
import os
import json
from scipy.interpolate import RegularGridInterpolator, NearestNDInterpolator
from scipy.ndimage import gaussian_filter
import warnings

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class WRFCoordinate:
    """WRF模式坐标信息"""
    longitude: np.ndarray  # 经度数组
    latitude: np.ndarray   # 纬度数组
    crs: str = "WGS84"     # 坐标参考系
    
    def __post_init__(self):
        if self.longitude.shape != self.latitude.shape:
            raise ValueError("经纬度数组形状必须一致")


@dataclass
class WRFTimeCoordinate:
    """WRF模式时空坐标"""
    time: np.ndarray       # 时间数组
    longitude: np.ndarray  # 经度二维数组
    latitude: np.ndarray   # 纬度二维数组
    levels: np.ndarray = field(default_factory=np.array)  # 气压层
    
    def get_spatial_shape(self) -> Tuple[int, int]:
        """获取空间维度形状"""
        return self.longitude.shape
    
    def get_temporal_shape(self) -> int:
        """获取时间维度长度"""
        return len(self.time)


@dataclass
class WRFVariable:
    """WRF模式变量"""
    name: str              # 变量名称
    units: str             # 单位
    description: str       # 描述
    data: np.ndarray       # 数据数组
    dimensions: Tuple[str, ...] = ('time', 'south_north', 'west_east')  # 维度
    
    def __getitem__(self, key):
        """支持数组索引访问"""
        return self.data[key]
    
    def mean(self, axis: Optional[Union[int, Tuple[int, ...]]] = None) -> np.ndarray:
        """计算均值"""
        return np.nanmean(self.data, axis=axis)
    
    def max(self, axis: Optional[Union[int, Tuple[int, ...]]] = None) -> np.ndarray:
        """计算最大值"""
        return np.nanmax(self.data, axis=axis)
    
    def min(self, axis: Optional[Union[int, Tuple[int, ...]]] = None) -> np.ndarray:
        """计算最小值"""
        return np.nanmin(self.data, axis=axis)


@dataclass
class SurfaceVariable:
    """地表气象变量"""
    temperature_2m: WRFVariable = None      # 2米气温 (K)
    dewpoint_2m: WRFVariable = None         # 2米露点温度 (K)
    u_component_10m: WRFVariable = None     # 10米U风分量 (m/s)
    v_component_10m: WRFVariable = None     # 10米V风分量 (m/s)
    surface_pressure: WRFVariable = None    # 地面气压 (Pa)
    sensible_heat_flux: WRFVariable = None  # 感热通量 (W/m²)
    latent_heat_flux: WRFVariable = None    # 潜热通量 (W/m²)
    skin_temperature: WRFVariable = None    # 皮肤温度 (K)
    ground_temperature: WRFVariable = None  # 地表温度 (K)
    
    def get_variable(self, name: str) -> Optional[WRFVariable]:
        """根据名称获取变量"""
        return getattr(self, name, None)


@dataclass
class UpperAirVariable:
    """高空探测变量"""
    u_component: WRFVariable = None         # U风分量
    v_component: WRFVariable = None         # V风分量
    temperature: WRFVariable = None         # 气温
    geopotential_height: WRFVariable = None # 位势高度
    relative_humidity: WRFVariable = None   # 相对湿度
    specific_humidity: WRFVariable = None   # 比湿
    
    def get_pressure_levels(self) -> np.ndarray:
        """获取气压层"""
        if self.geopotential_height is not None:
            return self.geopotential_height.levels
        return np.array([])


@dataclass
class WRFOutputData:
    """WRF模式输出数据结构"""
    time_coordinate: WRFTimeCoordinate = None
    surface_variables: SurfaceVariable = None
    upper_air_variables: UpperAirVariable = None
    metadata: Dict = field(default_factory=dict)
    
    def get_time_range(self) -> Tuple[datetime, datetime]:
        """获取时间范围"""
        if self.time_coordinate is not None and len(self.time_coordinate.time) > 0:
            return self.time_coordinate.time[0], self.time_coordinate.time[-1]
        return None, None
    
    def get_spatial_extent(self) -> Tuple[float, float, float, float]:
        """获取空间范围 (西, 东, 南, 北)"""
        if self.time_coordinate is not None:
            lon = self.time_coordinate.longitude
            lat = self.time_coordinate.latitude
            return np.min(lon), np.max(lon), np.min(lat), np.max(lat)
        return None, None


class WRFModelAdapter:
    """
    WRF模式数据适配器
    
    用于处理WRF模式输出数据，支持：
    - 数据读取和解析
    - 空间插值到目标区域
    - 时间序列提取
    - 热岛相关指标计算
    - 与遥感数据融合
    """
    
    # 常用气象变量名称映射
    VARIABLE_MAPPING = {
        'T2': 'temperature_2m',           # 2米气温
        'TD2': 'dewpoint_2m',             # 2米露点温度
        'U10': 'u_component_10m',         # 10米U风
        'V10': 'v_component_10m',         # 10米V风
        'PSFC': 'surface_pressure',       # 地面气压
        'HFX': 'sensible_heat_flux',      # 感热通量
        'LH': 'latent_heat_flux',         # 潜热通量
        'TSK': 'skin_temperature',        # 皮肤温度
        'TG': 'ground_temperature',       # 地表温度
    }
    
    # 变量单位转换表
    UNIT_CONVERSION = {
        'K': ('K', 1.0),           # 开尔文 -> 开尔文
        'degK': ('K', 1.0),        # 开尔文 -> 开尔文
        'm s-1': ('m/s', 1.0),     # 米每秒 -> 米每秒
        'Pa': ('Pa', 1.0),         # 帕斯卡 -> 帕斯卡
        'W m-2': ('W/m²', 1.0),    # 瓦每平方米 -> 瓦每平方米
    }
    
    def __init__(self, config: Optional[Dict] = None):
        """
        初始化WRF模式适配器
        
        Args:
            config: 配置字典，包含插值参数等
        """
        self.config = config or self._default_config()
        self.wrf_data: Optional[WRFOutputData] = None
        self.interpolator: Optional[RegularGridInterpolator] = None
        self.logger = logging.getLogger(self.__class__.__name__)
    
    def _default_config(self) -> Dict:
        """默认配置"""
        return {
            'interpolation_method': 'linear',
            'extrapolation_value': np.nan,
            'smoothing_sigma': 0,
            'target_resolution': 0.01,  # 度
            'time_zone': 'Asia/Shanghai',
            'temperature_unit': 'celsius',  # 摄氏度
            'variables_of_interest': [
                'temperature_2m',
                'surface_pressure',
                'sensible_heat_flux',
                'skin_temperature'
            ]
        }
    
    def load_wrf_output(self, filepath: str) -> WRFOutputData:
        """
        加载WRF模式输出数据
        
        Args:
            filepath: WRF输出文件路径 (支持 .nc, .nc4 格式)
            
        Returns:
            WRFOutputData: 解析后的数据结构
            
        Raises:
            FileNotFoundError: 文件不存在
            ValueError: 数据格式错误
        """
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"WRF数据文件不存在: {filepath}")
        
        self.logger.info(f"正在加载WRF模式输出数据: {filepath}")
        
        try:
            # 尝试使用netCDF4库读取
            try:
                import netCDF4 as nc
                data = nc.Dataset(filepath, 'r')
                wrf_data = self._parse_wrf_netcdf(data)
                data.close()
            except ImportError:
                # 尝试使用xarray读取
                try:
                    import xarray as xr
                    data = xr.open_dataset(filepath)
                    wrf_data = self._parse_wrf_xarray(data)
                    data.close()
                except ImportError:
                    # 使用numpy加载模拟数据
                    wrf_data = self._generate_simulated_data()
            
            self.wrf_data = wrf_data
            self.logger.info("WRF数据加载成功")
            return wrf_data
            
        except Exception as e:
            self.logger.error(f"加载WRF数据失败: {e}")
            raise
    
    def _parse_wrf_netcdf(self, data) -> WRFOutputData:
        """解析netCDF格式的WRF数据"""
        # 提取时间和坐标
        times = self._parse_wrf_times(data.variables['Times'][:])
        
        # 提取经纬度 (假设使用WRF标准投影)
        lon = data.variables['XLONG'][0].astype(np.float64)
        lat = data.variables['XLAT'][0].astype(np.float64)
        
        # 创建时间坐标对象
        time_coord = WRFTimeCoordinate(
            time=times,
            longitude=lon,
            latitude=lat
        )
        
        # 提取表面变量
        surface_vars = self._extract_surface_variables(data, time_coord)
        
        # 提取高空变量
        upper_air_vars = self._extract_upper_air_variables(data, time_coord)
        
        # 创建输出数据结构
        wrf_output = WRFOutputData(
            time_coordinate=time_coord,
            surface_variables=surface_vars,
            upper_air_variables=upper_air_vars,
            metadata={
                'source_file': data.filepath(),
                'simulation_start': str(times[0]) if len(times) > 0 else None,
                'simulation_end': str(times[-1]) if len(times) > 0 else None,
                'grid_shape': lon.shape
            }
        )
        
        return wrf_output
    
    def _parse_wrf_xarray(self, data) -> WRFOutputData:
        """解析xarray格式的WRF数据"""
        # 提取时间坐标
        times = pd.to_datetime(data.coords['Time'].values)
        
        # 提取经纬度
        lon = data.coords['XLONG'].values.astype(np.float64)
        lat = data.coords['XLAT'].values.astype(np.float64)
        
        time_coord = WRFTimeCoordinate(
            time=times,
            longitude=lon,
            latitude=lat
        )
        
        # 提取变量
        surface_vars = SurfaceVariable()
        
        # 温度转换
        if 'T2' in data.variables:
            temp_data = data.variables['T2'][:].astype(np.float64)
            surface_vars.temperature_2m = WRFVariable(
                name='T2',
                units='K',
                description='2米气温',
                data=temp_data
            )
        
        # 风速分量
        if 'U10' in data.variables:
            surface_vars.u_component_10m = WRFVariable(
                name='U10',
                units='m s-1',
                description='10米U风分量',
                data=data.variables['U10'][:].astype(np.float64)
            )
        
        if 'V10' in data.variables:
            surface_vars.v_component_10m = WRFVariable(
                name='V10',
                units='m s-1',
                description='10米V风分量',
                data=data.variables['V10'][:].astype(np.float64)
            )
        
        wrf_output = WRFOutputData(
            time_coordinate=time_coord,
            surface_variables=surface_vars,
            metadata={
                'source': 'xarray',
                'dimensions': dict(data.dims)
            }
        )
        
        return wrf_output
    
    def _generate_simulated_data(self) -> WRFOutputData:
        """
        生成模拟的WRF数据（用于演示和测试）
        
        在无法读取实际WRF数据时使用，生成符合实际规律的数据
        """
        self.logger.warning("使用模拟WRF数据进行演示")
        
        # 时间范围: 7天，小时数据
        start_time = datetime(2024, 7, 15, 0, 0, 0)
        times = np.array([start_time + timedelta(hours=i) for i in range(168)])  # 7天 * 24小时
        
        # 空间范围: 河南省某区域 (经度: 113-116, 纬度: 33-36)
        grid_size = (20, 25)  # 20x25网格
        lon_range = np.linspace(113.5, 115.5, grid_size[1])
        lat_range = np.linspace(34.0, 35.5, grid_size[0])
        lon_grid, lat_grid = np.meshgrid(lon_range, lat_range)
        
        time_coord = WRFTimeCoordinate(
            time=times,
            longitude=lon_grid,
            latitude=lat_grid
        )
        
        # 生成模拟温度数据 (白天高温，夜间低温)
        def generate_diurnal_temperature(base_temp: float, amplitude: float = 8.0):
            """生成日变化温度"""
            n_times = len(times)
            temp_series = np.zeros(n_times)
            
            for t in range(n_times):
                hour = times[t].hour
                # 日变化: 峰值在14:00，最低在05:00
                diurnal_cycle = amplitude * np.sin(2 * np.pi * (hour - 9) / 24)
                temp_series[t] = base_temp + diurnal_cycle
            
            return temp_series
        
        # 城市区域温度较高 (热岛效应)
        center_lon, center_lat = 113.8, 34.8
        distance_from_center = np.sqrt((lon_grid - center_lon)**2 + (lat_grid - center_lat)**2)
        urban_mask = distance_from_center < 0.3
        
        # 生成3D温度数据 (时间 x 纬度 x 经度)
        base_temp_city = 302.0  # 城市基础温度 K
        base_temp_rural = 298.0  # 农村基础温度 K
        
        temperature_3d = np.zeros((len(times), *grid_size))
        diurnal_temp = generate_diurnal_temperature(300.0)
        
        for t in range(len(times)):
            for i in range(grid_size[0]):
                for j in range(grid_size[1]):
                    if urban_mask[i, j]:
                        temperature_3d[t, i, j] = diurnal_temp[t] + 2.0
                    else:
                        temperature_3d[t, i, j] = diurnal_temp[t] - 1.0
        
        surface_vars = SurfaceVariable(
            temperature_2m=WRFVariable(
                name='T2',
                units='K',
                description='2米气温',
                data=temperature_3d
            ),
            skin_temperature=WRFVariable(
                name='TSK',
                units='K',
                description='地表皮肤温度',
                data=temperature_3d + np.random.randn(*temperature_3d.shape) * 0.5
            ),
            surface_pressure=WRFVariable(
                name='PSFC',
                units='Pa',
                description='地面气压',
                data=np.full((len(times), *grid_size), 101325.0) + 
                      np.random.randn(len(times), *grid_size) * 100
            ),
            sensible_heat_flux=WRFVariable(
                name='HFX',
                units='W m-2',
                description='感热通量',
                data=np.random.rand(len(times), *grid_size) * 300
            )
        )
        
        wrf_output = WRFOutputData(
            time_coordinate=time_coord,
            surface_variables=surface_vars,
            metadata={
                'source': 'simulated',
                'simulation_period': '2024-07-15 to 2024-07-22',
                'grid_resolution': '0.1 degree',
                'note': '此数据为模拟数据，仅用于演示'
            }
        )
        
        return wrf_output
    
    def _parse_wrf_times(self, times_array: np.ndarray) -> np.ndarray:
        """解析WRF时间数组"""
        parsed_times = []
        for t in times_array:
            time_str = ''.join([s.decode('utf-8') if isinstance(s, bytes) else s for s in t])
            parsed_times.append(datetime.strptime(time_str, '%Y-%m-%d_%H:%M:%S'))
        return np.array(parsed_times)
    
    def _extract_surface_variables(self, data, time_coord: WRFTimeCoordinate) -> SurfaceVariable:
        """提取表面变量"""
        surface_vars = SurfaceVariable()
        
        # 温度
        if 'T2' in data.variables:
            surface_vars.temperature_2m = WRFVariable(
                name='T2',
                units='K',
                description='2米气温',
                data=data.variables['T2'][:].astype(np.float64)
            )
        
        # 露点温度
        if 'TD2' in data.variables:
            surface_vars.dewpoint_2m = WRFVariable(
                name='TD2',
                units='K',
                description='2米露点温度',
                data=data.variables['TD2'][:].astype(np.float64)
            )
        
        # 风速分量
        if 'U10' in data.variables:
            surface_vars.u_component_10m = WRFVariable(
                name='U10',
                units='m s-1',
                description='10米U风分量',
                data=data.variables['U10'][:].astype(np.float64)
            )
        
        if 'V10' in data.variables:
            surface_vars.v_component_10m = WRFVariable(
                name='V10',
                units='m s-1',
                description='10米V风分量',
                data=data.variables['V10'][:].astype(np.float64)
            )
        
        # 气压
        if 'PSFC' in data.variables:
            surface_vars.surface_pressure = WRFVariable(
                name='PSFC',
                units='Pa',
                description='地面气压',
                data=data.variables['PSFC'][:].astype(np.float64)
            )
        
        # 热通量
        if 'HFX' in data.variables:
            surface_vars.sensible_heat_flux = WRFVariable(
                name='HFX',
                units='W m-2',
                description='感热通量',
                data=data.variables['HFX'][:].astype(np.float64)
            )
        
        if 'LH' in data.variables:
            surface_vars.latent_heat_flux = WRFVariable(
                name='LH',
                units='W m-2',
                description='潜热通量',
                data=data.variables['LH'][:].astype(np.float64)
            )
        
        # 温度
        if 'TSK' in data.variables:
            surface_vars.skin_temperature = WRFVariable(
                name='TSK',
                units='K',
                description='地表皮肤温度',
                data=data.variables['TSK'][:].astype(np.float64)
            )
        
        return surface_vars
    
    def _extract_upper_air_variables(self, data, time_coord: WRFTimeCoordinate) -> UpperAirVariable:
        """提取高空变量"""
        upper_air_vars = UpperAirVariable()
        
        # 如果有气压层数据，提取
        if 'P' in data.variables and 'PB' in data.variables:
            pressure = data.variables['P'][:] + data.variables['PB'][:]
            levels = np.unique(pressure[0, :, 0, 0])
            
            upper_air_vars.geopotential_height = WRFVariable(
                name='PH',
                units='m',
                description='位势高度',
                data=data.variables['PH'][:].astype(np.float64),
                dimensions=('time', 'bottom_top', 'south_north', 'west_east'),
                levels=levels
            )
        
        return upper_air_vars
    
    def run_simulation(self, config: Optional[Dict] = None) -> Dict:
        """
        执行WRF模式模拟配置
        
        Args:
            config: 模拟配置参数
            
        Returns:
            Dict: 模拟结果摘要
        """
        self.logger.info("开始WRF模式模拟配置...")
        
        sim_config = config or {}
        
        # 模拟参数
        result = {
            'status': 'configured',
            'start_time': datetime.now().isoformat(),
            'configuration': sim_config,
            'parameters': {
                'domain': {
                    'center_lat': sim_config.get('center_lat', 34.75),
                    'center_lon': sim_config.get('center_lon', 113.65),
                    'dx': sim_config.get('dx', 3000),  # 3km分辨率
                    'dy': sim_config.get('dy', 3000),
                    'parent_grid_ratio': sim_config.get('parent_grid_ratio', [1, 3, 1]),
                    'parent_id': sim_config.get('parent_id', [1, 1, 2]),
                },
                'time_control': {
                    'start_year': sim_config.get('start_year', 2024),
                    'start_month': sim_config.get('start_month', 7),
                    'start_day': sim_config.get('start_day', 15),
                    'start_hour': sim_config.get('start_hour', 0),
                    'end_hour': sim_config.get('end_hour', 168),  # 7天
                    'interval_seconds': sim_config.get('interval_seconds', 21600)
                },
                'physics': {
                    'mp_physics': sim_config.get('mp_physics', 6),  # Morrison微物理
                    'ra_lw_physics': sim_config.get('ra_lw_physics', 4),  # RRTM长波
                    'ra_sw_physics': sim_config.get('ra_sw_physics', 4),  # DRT短波
                    'bl_pbl_physics': sim_config.get('bl_pbl_physics', 1),  # YSU边界层
                    'sf_sfclay_physics': sim_config.get('sf_sfclay_physics', 1),
                    'sf_surface_physics': sim_config.get('sf_surface_physics', 2),  # Noah-MP
                    'cu_physics': sim_config.get('cu_physics', 1)  # Kain-Fritsch
                },
                'dynamics': {
                    'diff_opt': sim_config.get('diff_opt', 2),
                    'km_opt': sim_config.get('km_opt', 4),
                    'damp_opt': sim_config.get('damp_opt', 3),
                    'dampcoef': sim_config.get('dampcoef', 0.2)
                }
            },
            'nest': {
                'max_dom': sim_config.get('max_dom', 2),
                'i_parent_start': sim_config.get('i_parent_start', [1, 31]),
                'j_parent_start': sim_config.get('j_parent_start', [1, 18]),
                'parent_grid_ratio': sim_config.get('parent_grid_ratio', [1, 3]),
                'parent_time_step_ratio': sim_config.get('parent_time_step_ratio', [1, 3])
            }
        }
        
        self.logger.info("WRF模式模拟配置完成")
        return result
    
    def interpolate_to_location(self, 
                                lon: float, 
                                lat: float,
                                variable: str = 'temperature_2m',
                                time: Optional[datetime] = None) -> Optional[float]:
        """
        将WRF数据插值到指定位置
        
        Args:
            lon: 目标经度
            lat: 目标纬度
            variable: 变量名称
            time: 目标时间 (默认为最新时间)
            
        Returns:
            float: 插值结果 (如无法插值返回NaN)
        """
        if self.wrf_data is None:
            self.logger.warning("未加载WRF数据，无法进行插值")
            return np.nan
        
        try:
            wrf = self.wrf_data
            
            # 获取时间索引
            time_idx = 0
            if time is not None and wrf.time_coordinate is not None:
                times = wrf.time_coordinate.time
                if len(times) > 0:
                    time_diffs = [abs((t - time).total_seconds()) for t in times]
                    time_idx = np.argmin(time_diffs)
            
            # 获取变量数据
            var = None
            if variable == 'temperature_2m' and wrf.surface_variables.temperature_2m is not None:
                var = wrf.surface_variables.temperature_2m
            elif variable == 'skin_temperature' and wrf.surface_variables.skin_temperature is not None:
                var = wrf.surface_variables.skin_temperature
            
            if var is None:
                self.logger.warning(f"变量 {variable} 不存在")
                return np.nan
            
            # 提取指定时间的数据
            data_2d = var.data[time_idx]
            
            # 创建插值器
            lon_1d = wrf.time_coordinate.longitude[0, :] if len(wrf.time_coordinate.longitude.shape) == 2 else wrf.time_coordinate.longitude
            lat_1d = wrf.time_coordinate.latitude[:, 0] if len(wrf.time_coordinate.latitude.shape) == 2 else wrf.time_coordinate.latitude
            
            # 确保坐标正确
            if lon_1d.ndim == 1 and lat_1d.ndim == 1:
                interpolator = RegularGridInterpolator(
                    (lat_1d, lon_1d),
                    data_2d,
                    method=self.config.get('interpolation_method', 'linear'),
                    bounds_error=False,
                    fill_value=np.nan
                )
                
                result = interpolator([[lat, lon]])
                return float(result[0])
            
            return np.nan
            
        except Exception as e:
            self.logger.error(f"插值失败: {e}")
            return np.nan
    
    def extract_time_series(self, 
                           lon: float, 
                           lat: float,
                           variables: List[str] = None) -> pd.DataFrame:
        """
        提取指定位置的时间序列数据
        
        Args:
            lon: 经度
            lat: 纬度
            variables: 变量列表
            
        Returns:
            pd.DataFrame: 时间序列数据
        """
        if self.wrf_data is None:
            self.logger.warning("未加载WRF数据")
            return pd.DataFrame()
        
        variables = variables or ['temperature_2m', 'skin_temperature']
        
        times = self.wrf_data.time_coordinate.time
        
        data_dict = {'datetime': times}
        
        for var in variables:
            values = []
            for t in range(len(times)):
                val = self.interpolate_to_location(lon, lat, var, times[t])
                values.append(val)
            data_dict[var] = values
        
        df = pd.DataFrame(data_dict)
        df.set_index('datetime', inplace=True)
        
        return df
    
    def calculate_heat_island_intensity(self,
                                        urban_lon: float,
                                        urban_lat: float,
                                        rural_lon: float,
                                        rural_lat: float,
                                        variable: str = 'temperature_2m') -> pd.DataFrame:
        """
        计算热岛强度
        
        热岛强度 = 城区温度 - 郊区温度
        
        Args:
            urban_lon: 城区经度
            urban_lat: 城区纬度
            rural_lon: 郊区经度
            rural_lat: 郊区纬度
            variable: 计算依据的变量
            
        Returns:
            pd.DataFrame: 热岛强度时间序列
        """
        urban_series = self.extract_time_series(urban_lon, urban_lat, [variable])
        rural_series = self.extract_time_series(rural_lon, rural_lat, [variable])
        
        heat_intensity = pd.DataFrame({
            'datetime': urban_series.index,
            'urban_value': urban_series[variable].values,
            'rural_value': rural_series[variable].values,
            'heat_intensity': urban_series[variable].values - rural_series[variable].values
        })
        
        heat_intensity.set_index('datetime', inplace=True)
        
        return heat_intensity
    
    def calculate_composite_temperature(self,
                                        weights: Dict[str, float] = None) -> np.ndarray:
        """
        计算综合地表温度
        
        Args:
            weights: 各变量权重字典
            
        Returns:
            np.ndarray: 综合温度数组
        """
        if self.wrf_data is None or self.wrf_data.surface_variables is None:
            return np.array([])
        
        surface = self.wrf_data.surface_variables
        
        # 默认权重
        if weights is None:
            weights = {
                'skin_temperature': 0.6,
                'temperature_2m': 0.4
            }
        
        composite = np.zeros_like(surface.skin_temperature.data)
        total_weight = 0.0
        
        for var_name, weight in weights.items():
            var = getattr(surface, var_name, None)
            if var is not None:
                composite += var.data * weight
                total_weight += weight
        
        if total_weight > 0:
            composite = composite / total_weight
        
        return composite
    
    def smooth_data(self, 
                   data: np.ndarray, 
                   sigma: float = None) -> np.ndarray:
        """
        对数据进行平滑处理
        
        Args:
            data: 输入数据
            sigma: 高斯平滑参数
            
        Returns:
            np.ndarray: 平滑后的数据
        """
        sigma = sigma or self.config.get('smoothing_sigma', 0)
        
        if sigma > 0 and data.size > 1:
            return gaussian_filter(data, sigma=sigma)
        
        return data
    
    def export_data(self, 
                   filepath: str,
                   format: str = 'netcdf') -> bool:
        """
        导出处理后的数据
        
        Args:
            filepath: 输出文件路径
            format: 输出格式 ('netcdf', 'csv', 'json')
            
        Returns:
            bool: 是否导出成功
        """
        if self.wrf_data is None:
            self.logger.warning("无数据可导出")
            return False
        
        try:
            if format == 'json':
                return self._export_json(filepath)
            elif format == 'csv':
                return self._export_csv(filepath)
            else:
                return self._export_netcdf(filepath)
        
        except Exception as e:
            self.logger.error(f"导出失败: {e}")
            return False
    
    def _export_json(self, filepath: str) -> bool:
        """导出为JSON格式"""
        if self.wrf_data is None:
            return False
        
        export_dict = {
            'metadata': self.wrf_data.metadata,
            'time_range': {
                'start': str(self.wrf_data.time_coordinate.time[0]) if len(self.wrf_data.time_coordinate.time) > 0 else None,
                'end': str(self.wrf_data.time_coordinate.time[-1]) if len(self.wrf_data.time_coordinate.time) > 0 else None
            },
            'spatial_extent': self.wrf_data.get_spatial_extent(),
            'surface_temperature_mean': float(np.nanmean(self.wrf_data.surface_variables.temperature_2m.data)) if self.wrf_data.surface_variables.temperature_2m else None
        }
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(export_dict, f, ensure_ascii=False, indent=2)
        
        return True
    
    def _export_csv(self, filepath: str) -> bool:
        """导出为CSV格式"""
        if self.wrf_data is None:
            return False
        
        surface = self.wrf_data.surface_variables
        
        # 创建时间序列数据
        times = self.wrf_data.time_coordinate.time
        data_dict = {'datetime': [str(t) for t in times]}
        
        if surface.temperature_2m:
            data_dict['temperature_2m'] = np.nanmean(surface.temperature_2m.data, axis=(1, 2)).tolist()
        
        if surface.skin_temperature:
            data_dict['skin_temperature'] = np.nanmean(surface.skin_temperature.data, axis=(1, 2)).tolist()
        
        df = pd.DataFrame(data_dict)
        df.to_csv(filepath, index=False, encoding='utf-8')
        
        return True
    
    def _export_netcdf(self, filepath: str) -> bool:
        """导出为NetCDF格式"""
        try:
            import netCDF4 as nc
            
            if self.wrf_data is None:
                return False
            
            with nc.Dataset(filepath, 'w', format='NETCDF4') as ncfile:
                # 创建维度
                time_dim = ncfile.createDimension('time', None)
                lat_dim = ncfile.createDimension('lat', self.wrf_data.time_coordinate.latitude.shape[0])
                lon_dim = ncfile.createDimension('lon', self.wrf_data.time_coordinate.longitude.shape[1])
                
                # 创建坐标变量
                times = ncfile.createVariable('time', 'f8', ('time',))
                lats = ncfile.createVariable('lat', 'f8', ('lat', 'lon'))
                lons = ncfile.createVariable('lon', 'f8', ('lat', 'lon'))
                
                times[:] = range(len(self.wrf_data.time_coordinate.time))
                lats[:] = self.wrf_data.time_coordinate.latitude
                lons[:] = self.wrf_data.time_coordinate.longitude
                
                # 写入温度数据
                if self.wrf_data.surface_variables.temperature_2m:
                    temp_var = ncfile.createVariable(
                        'temperature_2m', 
                        'f4', 
                        ('time', 'lat', 'lon'),
                        fill_value=-9999.0
                    )
                    temp_var.units = 'K'
                    temp_var.description = '2米气温'
                    temp_var[:] = self.wrf_data.surface_variables.temperature_2m.data
                
                # 添加元数据
                ncfile.title = '空天地一体化智能监测平台 - WRF模式输出数据'
                ncfile.created_by = 'WRF Model Adapter'
                ncfile.creation_date = datetime.now().isoformat()
            
            return True
            
        except ImportError:
            self.logger.warning("netCDF4库未安装，无法导出NetCDF格式")
            return False
    
    def get_statistics(self, variable: str = 'temperature_2m') -> Dict:
        """
        获取变量统计信息
        
        Args:
            variable: 变量名称
            
        Returns:
            Dict: 统计信息字典
        """
        if self.wrf_data is None:
            return {}
        
        surface = self.wrf_data.surface_variables
        
        var = None
        if variable == 'temperature_2m' and surface.temperature_2m:
            var = surface.temperature_2m
        elif variable == 'skin_temperature' and surface.skin_temperature:
            var = surface.skin_temperature
        
        if var is None:
            return {}
        
        data = var.data
        
        return {
            'variable': var.name,
            'units': var.units,
            'description': var.description,
            'shape': data.shape,
            'min': float(np.nanmin(data)),
            'max': float(np.nanmax(data)),
            'mean': float(np.nanmean(data)),
            'std': float(np.nanstd(data)),
            'median': float(np.nanmedian(data)),
            'time_mean': float(np.nanmean(data, axis=(1, 2))),
            'spatial_mean': float(np.nanmean(data, axis=0))
        }
    
    def visualize(self, 
                 variable: str = 'temperature_2m',
                 time_index: int = 0,
                 show: bool = True) -> None:
        """
        可视化变量数据
        
        Args:
            variable: 变量名称
            time_index: 时间索引
            show: 是否显示图像
        """
        try:
            import matplotlib.pyplot as plt
            import matplotlib.dates as mdates
            
            if self.wrf_data is None:
                self.logger.warning("无数据可可视化")
                return
            
            surface = self.wrf_data.surface_variables
            
            var = None
            if variable == 'temperature_2m' and surface.temperature_2m:
                var = surface.temperature_2m
            elif variable == 'skin_temperature' and surface.skin_temperature:
                var = surface.skin_temperature
            
            if var is None:
                self.logger.warning(f"变量 {variable} 不存在")
                return
            
            fig, axes = plt.subplots(1, 2, figsize=(14, 5))
            
            # 空间分布图
            data_2d = var.data[time_index]
            lon = self.wrf_data.time_coordinate.longitude
            lat = self.wrf_data.time_coordinate.latitude
            
            im = axes[0].contourf(lon, lat, data_2d, levels=20, cmap='RdYlBu_r')
            axes[0].set_xlabel('Longitude')
            axes[0].set_ylabel('Latitude')
            axes[0].set_title(f'{var.description} Spatial Distribution')
            plt.colorbar(im, ax=axes[0], label=var.units)
            
            # 时间序列图
            time_mean = np.nanmean(var.data, axis=(1, 2))
            times = self.wrf_data.time_coordinate.time
            axes[1].plot(times, time_mean, 'b-', linewidth=1.5)
            axes[1].set_xlabel('Time')
            axes[1].set_ylabel(f'{var.description} ({var.units})')
            axes[1].set_title(f'{var.description} Time Series')
            axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%m-%d %H:%M'))
            plt.xticks(rotation=45)
            
            plt.tight_layout()
            
            if show:
                plt.show()
            
            return fig
            
        except ImportError:
            self.logger.warning("matplotlib库未安装，无法可视化")


def main():
    """主函数 - 演示WRF适配器使用"""
    
    # 创建适配器实例
    adapter = WRFModelAdapter()
    
    # 运行模拟配置
    sim_result = adapter.run_simulation({
        'center_lat': 34.75,
        'center_lon': 113.65,
        'dx': 3000,
        'max_dom': 2,
        'start_month': 7,
        'start_day': 15,
        'end_hour': 72
    })
    
    print("WRF模式模拟配置结果:")
    print(json.dumps(sim_result, ensure_ascii=False, indent=2))
    
    # 加载模拟数据
    wrf_data = adapter.load_wrf_output('dummy_wrf_output.nc')
    
    print("\n数据统计信息:")
    stats = adapter.get_statistics('temperature_2m')
    print(json.dumps(stats, indent=2))
    
    # 计算热岛强度
    heat_intensity = adapter.calculate_heat_island_intensity(
        urban_lon=113.8, urban_lat=34.8,
        rural_lon=114.5, rural_lat=34.5,
        variable='temperature_2m'
    )
    
    print("\n热岛强度时间序列 (前5行):")
    print(heat_intensity.head())
    
    # 导出数据
    adapter.export_data('wrf_output_summary.json', format='json')
    adapter.export_data('wrf_temperature_timeseries.csv', format='csv')
    
    print("\n数据导出完成")


if __name__ == '__main__':
    main()

