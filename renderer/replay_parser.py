from __future__ import annotations

import io
import re
import struct

from .errors import ErrorCode, RenderError
from .models import ReplayInfo


MD5_PATTERN = re.compile(r"^[0-9a-fA-F]{32}$")
MOD_BITS: tuple[tuple[int, str], ...] = (
    (1, "NF"), (2, "EZ"), (8, "HD"), (16, "HR"), (32, "SD"),
    (64, "DT"), (128, "RX"), (256, "HT"), (512, "NC"),
    (1024, "FL"), (2048, "AT"), (4096, "SO"), (8192, "AP"),
    (16384, "PF"), (1 << 30, "MR"),
)


def mods_from_bits(raw: int) -> list[str]:
    mods = [name for bit, name in MOD_BITS if raw & bit]
    # NC includes DT and PF includes SD in stable's bitset; show the specific mod.
    if "NC" in mods and "DT" in mods:
        mods.remove("DT")
    if "PF" in mods and "SD" in mods:
        mods.remove("SD")
    return mods


def _read_exact(stream: io.BytesIO, length: int) -> bytes:
    data = stream.read(length)
    if len(data) != length:
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay is truncated")
    return data


def _unpack(stream: io.BytesIO, fmt: str):
    size = struct.calcsize(fmt)
    return struct.unpack(fmt, _read_exact(stream, size))[0]


def _read_uleb128(stream: io.BytesIO) -> int:
    result = 0
    for shift in range(0, 70, 7):
        byte = _unpack(stream, "<B")
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result
    raise RenderError(ErrorCode.INVALID_REPLAY, "Invalid replay string length")


def _read_osu_string(stream: io.BytesIO, *, maximum: int = 4096) -> str:
    marker = _unpack(stream, "<B")
    if marker == 0x00:
        return ""
    if marker != 0x0B:
        raise RenderError(ErrorCode.INVALID_REPLAY, "Invalid replay string marker")
    length = _read_uleb128(stream)
    if length > maximum:
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay string is too long")
    try:
        return _read_exact(stream, length).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay contains invalid UTF-8") from exc


def parse_replay(data: bytes) -> ReplayInfo:
    if len(data) < 64:
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay is too small")
    stream = io.BytesIO(data)
    try:
        mode = _unpack(stream, "<B")
        game_version = _unpack(stream, "<i")
        beatmap_md5 = _read_osu_string(stream, maximum=64)
        player_name = _read_osu_string(stream, maximum=256)
        replay_md5 = _read_osu_string(stream, maximum=64)
        count_300 = _unpack(stream, "<h")
        count_100 = _unpack(stream, "<h")
        count_50 = _unpack(stream, "<h")
        count_geki = _unpack(stream, "<h")
        count_katu = _unpack(stream, "<h")
        count_miss = _unpack(stream, "<h")
        score = _unpack(stream, "<i")
        max_combo = _unpack(stream, "<h")
        perfect = bool(_unpack(stream, "<?"))
        mods_raw = _unpack(stream, "<i")
        _read_osu_string(stream, maximum=1_000_000)  # life bar graph
        timestamp_ticks = _unpack(stream, "<q")
        compressed_length = _unpack(stream, "<i")
    except (struct.error, OverflowError) as exc:
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay header is invalid") from exc

    if mode not in {0, 1, 2, 3}:
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay mode is invalid")
    if not MD5_PATTERN.fullmatch(beatmap_md5):
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay has no valid beatmap MD5")
    if compressed_length < 0 or compressed_length > len(data) - stream.tell():
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay frame data is truncated")
    if not player_name.strip():
        raise RenderError(ErrorCode.INVALID_REPLAY, "Replay player name is missing")

    return ReplayInfo(
        mode=mode,
        game_version=game_version,
        beatmap_md5=beatmap_md5.lower(),
        player_name=player_name,
        replay_md5=replay_md5,
        count_300=count_300,
        count_100=count_100,
        count_50=count_50,
        count_geki=count_geki,
        count_katu=count_katu,
        count_miss=count_miss,
        score=score,
        max_combo=max_combo,
        perfect=perfect,
        mods_raw=mods_raw,
        timestamp_ticks=timestamp_ticks,
    )
