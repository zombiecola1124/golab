import time
from datetime import datetime, timezone

from config import db


def log_command(command: str, args: str, success: bool, latency_ms: int,
                result_summary: str, doc_refs: list[str] | None = None):
    db.collection("system_logs").add({
        "timestamp": datetime.now(timezone.utc),
        "command": command,
        "args": args,
        "success": success,
        "latency_ms": latency_ms,
        "result_summary": result_summary,
        "doc_refs": doc_refs or [],
    })


class CommandTimer:
    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.elapsed_ms = int((time.perf_counter() - self.start) * 1000)
