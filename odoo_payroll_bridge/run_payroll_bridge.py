from __future__ import annotations

import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "payroll_bridge.app:app",
        host=os.environ.get("PAYROLL_BRIDGE_HOST", "127.0.0.1"),
        port=int(os.environ.get("PAYROLL_BRIDGE_PORT", "8010")),
        reload=os.environ.get("PAYROLL_BRIDGE_RELOAD", "").lower() in {"1", "true", "yes"},
    )
