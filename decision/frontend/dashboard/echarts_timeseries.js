/**
 * 微境智护 — ECharts 横向时序曲线
 * 24h 温度 / 湿度 / 地表温 / 降水 时序
 */

export class EChartsTimeseries {
  constructor() {
    this._chart = null;
    this._el = null;
    this._resizeHandler = null;
    this._init();
  }

  _init() {
    this._el = document.getElementById("timeseries-chart");
    if (!this._el) return;

    if (typeof echarts !== "undefined") {
      this._buildChart();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js";

    let loaded = false;
    const tryLoad = (src) => {
      script.src = src;
      loaded = false;
      script.parentNode?.replaceChild(script.cloneNode(true), script);
    };

    script.onload = () => {
      loaded = true;
      this._buildChart();
    };

    script.onerror = () => {
      if (!loaded) {
        tryLoad("https://cdn.bootcdn.net/ajax/libs/echarts/5.4.3/echarts.min.js");
        setTimeout(() => {
          if (!loaded) {
            console.warn("[ECharts] CDN 加载失败，使用降级提示");
            if (this._el) {
              this._el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5a8aaa;font-size:12px;">时序图加载中...</div>';
            }
          }
        }, 5000);
      }
    };

    document.head.appendChild(script);
  }

  _buildChart() {
    this._chart = echarts.init(this._el, null, { renderer: "canvas" });

    // 生成 24h 模拟时序数据
    const now = new Date();
    const hours = [];
    const temps = [], humids = [], surfTemps = [], precips = [];

    for (let i = 23; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(d.getHours() - i);
      hours.push(`${String(d.getHours()).padStart(2, "0")}:00`);

      // 温度：白天高，夜间低（正弦波动）
      const hour = d.getHours();
      const tempPeak = hour >= 10 && hour <= 16;
      temps.push(32.5 + (tempPeak ? 5 * Math.sin((hour - 10) * Math.PI / 6) : 0) + (Math.random() - 0.5) * 1.5);
      humids.push(68 - (tempPeak ? 15 : 0) + (Math.random() - 0.5) * 3);
      surfTemps.push(40 + (tempPeak ? 10 * Math.sin((hour - 10) * Math.PI / 6) : 0) + (Math.random() - 0.5) * 2);
      precips.push(Math.random() > 0.9 ? Math.random() * 3 : 0);
    }

    const option = {
      backgroundColor: "transparent",
      grid: {
        top: 8, right: 12, bottom: 20, left: 38, containLabel: false,
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(10,30,60,0.95)",
        borderColor: "rgba(0,180,255,0.3)",
        textStyle: { color: "#b3e0ff", fontSize: 11 },
        formatter: (params) => {
          let s = `<b>${params[0].axisValue}</b><br/>`;
          params.forEach(p => {
            if (p.value > 0 || p.seriesName === "降水") {
              s += `${p.marker} ${p.seriesName}: <b>${typeof p.value === "number" ? p.value.toFixed(1) : p.value}</b>${p.seriesName === "降水" ? "mm" : "°C"}<br/>`;
            }
          });
          return s;
        },
      },
      legend: {
        data: ["温度", "湿度", "地表温", "降水"],
        bottom: 0,
        textStyle: { color: "#5a8aaa", fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
      },
      xAxis: {
        type: "category",
        data: hours,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "rgba(0,180,255,0.15)" } },
        axisLabel: { color: "#5a8aaa", fontSize: 9, interval: 3 },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: [
        {
          // 左轴：温度
          type: "value",
          min: 15,
          max: 55,
          axisLine: { show: false },
          axisLabel: { color: "#5a8aaa", fontSize: 9, formatter: v => `${v}°` },
          splitLine: { lineStyle: { color: "rgba(0,180,255,0.08)" } },
        },
        {
          // 右轴：降水
          type: "value",
          min: 0,
          max: 5,
          axisLine: { show: false },
          axisLabel: { color: "#5a8aaa", fontSize: 9, formatter: v => `${v}mm` },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "温度",
          type: "line",
          smooth: 0.4,
          symbol: "none",
          lineStyle: { color: "#ff6644", width: 1.5 },
          areaStyle: { color: "rgba(255,102,68,0.08)" },
          data: temps,
        },
        {
          name: "地表温",
          type: "line",
          smooth: 0.4,
          symbol: "none",
          lineStyle: { color: "#ffcc00", width: 1.5 },
          data: surfTemps,
        },
        {
          name: "降水",
          type: "bar",
          yAxisIndex: 1,
          barMaxWidth: 6,
          itemStyle: { color: "rgba(68,136,255,0.6)", borderRadius: [2, 2, 0, 0] },
          data: precips,
        },
      ],
    };

    this._chart.setOption(option);

    this._resizeHandler = () => this._chart?.resize();
    window.addEventListener("resize", this._resizeHandler);
  }

  update(newData) {
    if (!this._chart) return;
    // 追加最新数据点，滚动显示
    // For demo, just update with fresh mock data
    this._chart.setOption({
      series: [
        { data: newData?.temps ?? [] },
        { data: newData?.surfTemps ?? [] },
        { data: newData?.precips ?? [] },
      ],
    });
  }

  destroy() {
    if (this._resizeHandler) {
      window.removeEventListener("resize", this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._chart) {
      this._chart.dispose();
      this._chart = null;
    }
  }
}
