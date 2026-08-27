from __future__ import annotations

import struct


def osu_string(value: str) -> bytes:
    data = value.encode("utf-8")
    if not data:
        return b"\x00"
    length = len(data)
    encoded = bytearray()
    while True:
        byte = length & 0x7F
        length >>= 7
        encoded.append(byte | (0x80 if length else 0))
        if not length:
            break
    return b"\x0b" + bytes(encoded) + data


def replay_bytes(beatmap_md5: str, *, replay_md5: str = "b" * 32, mode: int = 0) -> bytes:
    return b"".join([
        struct.pack("<Bi", mode, 20250101),
        osu_string(beatmap_md5),
        osu_string("Test Player"),
        osu_string(replay_md5),
        struct.pack("<hhhhhh", 300, 20, 3, 0, 0, 1),
        struct.pack("<ih?i", 1_234_567, 500, False, 8),
        osu_string(""),
        struct.pack("<qi", 638000000000000000, 0),
    ])
