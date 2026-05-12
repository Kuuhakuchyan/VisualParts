"""
GEE认证与设置助手
首次使用GEE前，运行此脚本完成认证
"""

import subprocess
import sys
import os
from pathlib import Path


def check_gee_installed() -> bool:
    """检查earthengine-api是否已安装"""
    try:
        import ee
        return True
    except ImportError:
        return False


def check_gee_initialized() -> bool:
    """检查GEE是否已认证"""
    # GEE凭证存储在用户目录
    cred_path = Path.home() / ".config" / "earthengine" / "credentials"
    return cred_path.exists()


def run_authentication():
    """运行GEE认证流程"""
    if check_gee_initialized():
        print("[✓] GEE已认证，凭证存在")
        return True

    print("=" * 60)
    print("Google Earth Engine 认证向导")
    print("=" * 60)
    print()
    print("步骤1: 打开浏览器访问 https://code.earthengine.google.com")
    print("      使用Google账号登录")
    print("      注意: 如无GEE访问权限，需先申请: https://signup.earthengine.google.com/")
    print()
    print("步骤2: 运行以下命令完成认证:")
    print()
    print("   # 激活虚拟环境")
    venv_activate = Path(__file__).parent.parent / ".venv" / "Scripts" / "activate"
    print(f"   source {venv_activate}")
    print()
    print("   # GEE认证")
    print("   earthengine authenticate")
    print()
    print("步骤3: 按提示在浏览器中打开链接，获取授权码")
    print("      粘贴授权码到终端即可完成认证")
    print()
    print("=" * 60)

    # 询问是否现在运行
    try:
        resp = input("\n是否现在运行认证? (y/n): ").strip().lower()
        if resp == "y":
            print("\n启动认证流程...")
            subprocess.run(
                [sys.executable, "-m", "earthengine", "authenticate"],
                check=True,
            )
            print("\n[✓] 认证完成!")
            return True
    except (EOFError, KeyboardInterrupt):
        pass

    return False


def test_connection():
    """测试GEE连接"""
    try:
        import ee
        ee.Initialize()
        print("[✓] GEE连接成功!")
        info = ee.Image("LANDSAT/LC08/C02/T1_L2/LC08_124036_20240101").getInfo()
        print(f"    Landsat影像ID: {info.get('id', 'N/A')}")
        return True
    except Exception as e:
        print(f"[✗] GEE连接失败: {e}")
        return False


if __name__ == "__main__":
    print("Google Earth Engine 设置检查")
    print("-" * 40)

    if not check_gee_installed():
        print("[✗] earthengine-api 未安装")
        print("正在安装...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "earthengine-api"],
            check=True,
        )
        print("[✓] 安装完成")
    else:
        print("[✓] earthengine-api 已安装")

    run_authentication()
    test_connection()
