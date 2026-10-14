"""
LexEase Model Artifact Manager.

Verifies local checkpoint and tokenizer files, distinguishing the Legal-BERT base encoder
from the fine-tuned LexEase risk assessment checkpoint. Supports Git LFS storage and
Hugging Face Hub repository synchronization using server-side configuration secrets.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from pathlib import Path

logger = logging.getLogger("ModelArtifactManager")

ROOT = Path(__file__).resolve().parents[2]
BASE_MODEL_NAME = "nlpaueb/legal-bert-base-uncased"
DEFAULT_CHECKPOINT_DIR = ROOT / "ml" / "models" / "final_risk_model"
REQUIRED_CHECKPOINT_FILES = [
    "pytorch_model.bin",
    "metadata.json",
    "tokenizer_config.json",
]


def _sanitize_error_text(text: str) -> str:
    """Scrub tokens, API keys, and sensitive paths from error messages."""
    text = re.sub(r"(token|key|secret|password)[=:\s]+[^\s]+", r"\1=[REDACTED]", text, flags=re.IGNORECASE)
    text = re.sub(r"https?://[^:@\s]+:[^@\s]+@", "https://[REDACTED]@", text)
    return text


def is_valid_weights_file(weights_path: Path) -> bool:
    """Check if weights file exists, is sufficiently sized (>1MB), and not a Git LFS text pointer."""
    if not weights_path.is_file():
        return False
    try:
        size = weights_path.stat().st_size
        if size < 1_000_000:
            return False
        # Read header to ensure it is not a Git LFS pointer text file
        with open(weights_path, "rb") as f:
            header = f.read(100)
            if header.startswith(b"version https://git-lfs.github.com/spec/v1"):
                return False
        return True
    except Exception:
        return False


def verify_checkpoint_artifacts(model_dir: Path | str) -> tuple[bool, list[str]]:
    """
    Verifies that required checkpoint and tokenizer artifacts are present and valid.
    Returns (is_valid, list_of_missing_or_corrupt_files).
    """
    path = Path(model_dir)
    missing: list[str] = []

    if not path.is_dir():
        return False, [f"Directory not found: {path}"]

    weights_file = path / "pytorch_model.bin"
    if not is_valid_weights_file(weights_file):
        missing.append("pytorch_model.bin (missing, <1MB, or unresolved Git LFS pointer)")

    for req in ("metadata.json", "tokenizer_config.json"):
        if not (path / req).is_file():
            missing.append(req)

    # Need at least one tokenizer vocabulary/definition file
    has_vocab = (path / "tokenizer.json").is_file() or (path / "vocab.txt").is_file()
    if not has_vocab:
        missing.append("tokenizer.json or vocab.txt")

    return (len(missing) == 0), missing


def sync_from_huggingface_hub(
    repo_id: str,
    target_dir: Path | str,
    revision: str = "main",
    token: str | None = None,
) -> Path:
    """
    Downloads model artifacts from Hugging Face Hub into target_dir.
    Uses server-side secrets only; never logs or displays token values.
    """
    dest = Path(target_dir)
    dest.mkdir(parents=True, exist_ok=True)

    # Ensure huggingface_hub is available (bridging ML venv if needed)
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        ml_site = ROOT / "ml" / ".venv" / "Lib" / "site-packages"
        if ml_site.is_dir() and str(ml_site) not in sys.path:
            sys.path.append(str(ml_site))
        from huggingface_hub import hf_hub_download

    logger.info(f"Downloading LexEase model artifacts from Hugging Face repo: {repo_id} (revision: {revision})")

    files_to_fetch = ["pytorch_model.bin", "metadata.json", "tokenizer_config.json", "tokenizer.json"]
    orig_hf_offline = os.environ.get("HF_HUB_OFFLINE")
    orig_tf_offline = os.environ.get("TRANSFORMERS_OFFLINE")
    try:
        # Explicit remote sync requested: temporarily allow outbound connection to Hugging Face
        os.environ["HF_HUB_OFFLINE"] = "0"
        os.environ["TRANSFORMERS_OFFLINE"] = "0"
        for filename in files_to_fetch:
            try:
                downloaded_path = hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    revision=revision,
                    token=token or os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN"),
                    local_dir=str(dest),
                    local_dir_use_symlinks=False,
                )
                logger.info(f"Retrieved {filename} from Hugging Face Hub.")
            except Exception as exc:
                # tokenizer.json is optional if vocab.txt is fetched, others are required
                if filename == "tokenizer.json":
                    try:
                        hf_hub_download(
                            repo_id=repo_id,
                            filename="vocab.txt",
                            revision=revision,
                            token=token or os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN"),
                            local_dir=str(dest),
                            local_dir_use_symlinks=False,
                        )
                        continue
                    except Exception:
                        pass
                sanitized = _sanitize_error_text(str(exc))
                raise RuntimeError(f"Failed to download '{filename}' from Hugging Face repository '{repo_id}': {sanitized}") from None
    finally:
        if orig_hf_offline is not None:
            os.environ["HF_HUB_OFFLINE"] = orig_hf_offline
        else:
            os.environ.pop("HF_HUB_OFFLINE", None)
        if orig_tf_offline is not None:
            os.environ["TRANSFORMERS_OFFLINE"] = orig_tf_offline
        else:
            os.environ.pop("TRANSFORMERS_OFFLINE", None)

    return dest


def ensure_lexease_model_artifacts(target_dir: Path | str | None = None) -> Path:
    """
    Ensures that the LexEase fine-tuned checkpoint artifacts are present and ready for inference and training.
    If local/Git-LFS artifacts are missing or unresolved, attempts download from LEXEASE_MODEL_REPO_ID.
    Fails with a clear, sanitized error message if artifacts cannot be prepared.
    """
    dest = Path(target_dir) if target_dir else DEFAULT_CHECKPOINT_DIR
    is_valid, missing = verify_checkpoint_artifacts(dest)
    if is_valid:
        return dest

    hf_repo_id = os.getenv("LEXEASE_MODEL_REPO_ID")
    if hf_repo_id and hf_repo_id.strip():
        revision = os.getenv("LEXEASE_MODEL_REVISION", "main")
        token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN")
        try:
            sync_from_huggingface_hub(
                repo_id=hf_repo_id.strip(),
                target_dir=dest,
                revision=revision.strip(),
                token=token.strip() if token else None,
            )
            is_valid, missing = verify_checkpoint_artifacts(dest)
            if is_valid:
                return dest
            raise RuntimeError(f"Hugging Face download completed, but required files are still missing: {', '.join(missing)}")
        except Exception as exc:
            sanitized = _sanitize_error_text(str(exc))
            raise RuntimeError(f"Failed to prepare LexEase model artifacts from Hugging Face: {sanitized}") from None

    # Neither valid local files nor HF configuration available
    raise FileNotFoundError(
        f"LexEase fine-tuned checkpoint artifacts are missing or incomplete at '{dest.relative_to(ROOT) if dest.is_relative_to(ROOT) else dest}'. "
        f"Missing: {', '.join(missing)}. "
        "To resolve this, either pull Git LFS artifacts via `git lfs pull` or configure the server-side environment "
        "variable `LEXEASE_MODEL_REPO_ID` (and optional `LEXEASE_MODEL_REVISION` / `HF_TOKEN`) to synchronize from Hugging Face."
    )
