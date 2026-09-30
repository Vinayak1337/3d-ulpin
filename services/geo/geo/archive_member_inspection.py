"""One exact GeoJSON member profile; ZIP stays the source authority."""
import base64

from .gis_inspection import inspect_gis
from .native_archive_member import ArchiveMemberError, MAX_NATIVE_BYTES, read_archive_member
from .native_gis import _raw
from .validation import InputError


def inspect_archive_member(data):
    if not isinstance(data, dict) or set(data) != {"base64", "outerSha256", "ordinal", "memberSha256", "memberBytes"}:
        raise InputError("ARCHIVE_INVALID_MEMBER_REFERENCE")
    encoded = data["base64"]
    if not isinstance(encoded, str) or len(encoded) > (MAX_NATIVE_BYTES + 2) // 3 * 4:
        raise InputError("ARCHIVE_SOURCE_BYTE_LIMIT")
    try:
        raw = _raw(data)
        member = read_archive_member(raw, data["outerSha256"], data["ordinal"], data["memberSha256"], data["memberBytes"])
    except ArchiveMemberError as error:
        raise InputError("ARCHIVE_" + error.code) from None
    except InputError:
        raise InputError("ARCHIVE_SOURCE_BYTES_INVALID") from None
    if member.lineage["routeHint"] != "geojson":
        raise InputError("ARCHIVE_MEMBER_PROFILE_UNSUPPORTED")
    try:
        inspection = inspect_gis({"base64": base64.b64encode(member.data).decode("ascii")})
    except InputError:
        raise InputError("ARCHIVE_GIS_UNSUPPORTED") from None
    # The route hint alone cannot admit JSON metadata or ArcGIS JSON as GeoJSON.
    if inspection["format"] != "geojson":
        raise InputError("ARCHIVE_MEMBER_PROFILE_UNSUPPORTED")
    return {"lineage": member.lineage, "inspection": inspection}
