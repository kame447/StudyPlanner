from pathlib import Path

_original_write_text = Path.write_text


def _write_text_with_weekly_candidate_identity_fix(path: Path, data: str, *args, **kwargs):
    if str(path).endswith('src/components/NaturalLanguageAssistant.tsx'):
        data = data.replace('candidate.id', 'candidate.stableKey')
    return _original_write_text(path, data, *args, **kwargs)


Path.write_text = _write_text_with_weekly_candidate_identity_fix
