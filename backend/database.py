"""
微境智护 — 数据库模块
PostgreSQL 数据持久化（使用 SQLAlchemy ORM）
"""

import os
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    create_engine,
    Column,
    String,
    Float,
    Integer,
    DateTime,
    Boolean,
    JSON,
    Text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://weijing:weijing@localhost:5432/weijing"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class BuildingModel(Base):
    __tablename__ = "buildings"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    height = Column(Float, nullable=False)
    albedo = Column(Float, default=0.3)
    base_temp = Column(Float, default=30.0)
    building_type = Column(String(32), default="commercial")
    lon = Column(Float, nullable=False)
    lat = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    active = Column(Boolean, default=True)


class ScenarioModel(Base):
    __tablename__ = "scenarios"

    id = Column(String(64), primary_key=True)
    building_id = Column(String(64), nullable=False)
    action = Column(String(16), nullable=False)  # ADD | REMOVE
    radius_meters = Column(Float, default=100.0)
    temp_delta = Column(Float, nullable=False)
    confidence = Column(Float, default=0.85)
    reasoning_steps = Column(JSON, default=list)
    building_info = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    revoked = Column(Boolean, default=False)


class WeatherSnapshotModel(Base):
    __tablename__ = "weather_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    temperature = Column(Float)
    humidity = Column(Float)
    surface_temp = Column(Float)
    pressure = Column(Float)
    wind_speed = Column(Float)
    wind_direction = Column(Float)
    solar_radiation = Column(Float)
    uhi_intensity = Column(Float)
    aqi = Column(Integer)
    heat_health_risk = Column(Integer)


def init_db():
    """初始化数据库表"""
    Base.metadata.create_all(bind=engine)


def get_db():
    """上下文管理器：自动获取和释放数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =============================================================================
# Building CRUD
# =============================================================================

def create_building(db: Session, building_id: str, name: str, height: float,
                    albedo: float, base_temp: float, lon: float, lat: float,
                    building_type: str = "commercial") -> BuildingModel:
    record = BuildingModel(
        id=building_id,
        name=name,
        height=height,
        albedo=albedo,
        base_temp=base_temp,
        building_type=building_type,
        lon=lon,
        lat=lat,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_building(db: Session, building_id: str) -> Optional[BuildingModel]:
    return db.query(BuildingModel).filter(
        BuildingModel.id == building_id,
        BuildingModel.active == True  # noqa: E712
    ).first()


def list_buildings(db: Session, limit: int = 100) -> list[BuildingModel]:
    return db.query(BuildingModel).filter(
        BuildingModel.active == True  # noqa: E712
    ).limit(limit).all()


def delete_building(db: Session, building_id: str) -> bool:
    record = get_building(db, building_id)
    if record:
        record.active = False
        db.commit()
        return True
    return False


# =============================================================================
# Scenario CRUD
# =============================================================================

def create_scenario(db: Session, scenario_id: str, building_id: str,
                    action: str, radius_meters: float, temp_delta: float,
                    confidence: float, reasoning_steps: list,
                    building_info: dict) -> ScenarioModel:
    record = ScenarioModel(
        id=scenario_id,
        building_id=building_id,
        action=action,
        radius_meters=radius_meters,
        temp_delta=temp_delta,
        confidence=confidence,
        reasoning_steps=reasoning_steps,
        building_info=building_info,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_scenario(db: Session, scenario_id: str) -> Optional[ScenarioModel]:
    return db.query(ScenarioModel).filter(
        ScenarioModel.id == scenario_id
    ).first()


def list_scenarios(db: Session, limit: int = 100, include_revoked: bool = False
                   ) -> list[ScenarioModel]:
    q = db.query(ScenarioModel)
    if not include_revoked:
        q = q.filter(ScenarioModel.revoked == False)  # noqa: E712
    return q.order_by(ScenarioModel.created_at.desc()).limit(limit).all()


def revoke_scenario(db: Session, scenario_id: str) -> bool:
    record = get_scenario(db, scenario_id)
    if record:
        record.revoked = True
        db.commit()
        return True
    return False


# =============================================================================
# Weather Snapshot
# =============================================================================

def save_weather_snapshot(db: Session, data: dict) -> WeatherSnapshotModel:
    snapshot = WeatherSnapshotModel(
        temperature=data.get("temperature"),
        humidity=data.get("humidity"),
        surface_temp=data.get("surfaceTemp"),
        pressure=data.get("pressure"),
        wind_speed=data.get("windSpeed"),
        wind_direction=data.get("windDirection"),
        solar_radiation=data.get("solarRadiation"),
        uhi_intensity=data.get("uhiIntensity"),
        aqi=data.get("aqi"),
        heat_health_risk=data.get("heatHealthRisk"),
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot
