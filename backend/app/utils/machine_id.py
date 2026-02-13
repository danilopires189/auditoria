from __future__ import annotations

import socket
import uuid

from app.utils.hashers import sha256_text


def get_machine_id() -> str:
    hostname = socket.gethostname()
    mac = uuid.getnode()
    return sha256_text(f"{hostname}:{mac}")