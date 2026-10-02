import os
import sys
from pathlib import Path

import uvicorn

from workbench.config import settings

os.environ["PATH"] = (
    str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", "")
)

if __name__ == "__main__":
    uvicorn.run(
        "workbench.app:app", host=settings.backend_host, port=settings.backend_port
    )
