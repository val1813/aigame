import asyncio
import json
from collections import defaultdict


class WSBroadcaster:
    def __init__(self):
        self._connections: dict[str, set] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def register(self, session_id: str, ws):
        async with self._lock:
            self._connections[session_id].add(ws)

    async def unregister(self, session_id: str, ws):
        async with self._lock:
            self._connections[session_id].discard(ws)
            if not self._connections[session_id]:
                self._connections.pop(session_id, None)

    async def broadcast(self, session_id: str, event: dict):
        conns = set(self._connections.get(session_id, set()))
        if not conns:
            return
        message = json.dumps(event, ensure_ascii=False)
        dead = set()
        for ws in conns:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._connections[session_id] -= dead


broadcaster = WSBroadcaster()
