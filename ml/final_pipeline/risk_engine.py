import os
import sys

# Enforce offline Hugging Face loading to prevent network checks
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"

import json
import torch
from transformers import AutoTokenizer

# Resolve paths
script_dir = os.path.dirname(os.path.abspath(__file__))
ml_dir = os.path.dirname(script_dir)
project_root = os.path.dirname(ml_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from ml.evaluation.evaluate_pretrained_risk_models import MultiTaskLegalModel

class LegalRiskEngine:
    def _resolve_active_model_dir(self):
        active_manifest = os.path.join(ml_dir, "models", "active_risk_model.json")
        target_dir = os.path.join(ml_dir, "models", "final_risk_model")
        manifest_mtime = None
        version = None
        if os.path.isfile(active_manifest):
            try:
                manifest_mtime = os.path.getmtime(active_manifest)
                with open(active_manifest, "r", encoding="utf-8") as manifest_file:
                    active_model = json.load(manifest_file)
                candidate_dir = os.path.realpath(os.path.join(ml_dir, active_model["model_path"]))
                models_root = os.path.realpath(os.path.join(ml_dir, "models"))
                if os.path.commonpath([candidate_dir, models_root]) != models_root:
                    raise ValueError("Active risk model path must stay within ml/models.")
                target_dir = candidate_dir
                version = active_model.get("version")
            except Exception:
                target_dir = os.path.join(ml_dir, "models", "final_risk_model")
                manifest_mtime = None
                version = None
        return target_dir, manifest_mtime, version

    def _load_primary_model(self):
        target_dir, manifest_mtime, version = self._resolve_active_model_dir()
        from ml.models.artifact_manager import ensure_lexease_model_artifacts
        ensure_lexease_model_artifacts(target_dir)
        metadata_path = os.path.join(target_dir, "metadata.json")
        with open(metadata_path, "r", encoding="utf-8") as f:
            meta = json.load(f)

        tokenizer = AutoTokenizer.from_pretrained(target_dir)
        model = MultiTaskLegalModel("nlpaueb/legal-bert-base-uncased", meta["num_labels"])
        model.load_state_dict(torch.load(os.path.join(target_dir, "pytorch_model.bin"), map_location=self.device))
        model = model.to(self.device)
        model.eval()

        self.model_dir = target_dir
        self.meta = meta
        self.tokenizer = tokenizer
        self.model = model
        self._manifest_mtime = manifest_mtime
        self.active_version = version or meta.get("model_version", "baseline")

    def reload_if_updated(self) -> bool:
        target_dir, manifest_mtime, _ = self._resolve_active_model_dir()
        if target_dir != self.model_dir or manifest_mtime != self._manifest_mtime:
            self._load_primary_model()
            return True
        return False

    def reload(self):
        self._load_primary_model()

    def __init__(self, device):
        self.device = device
        self._manifest_mtime = None
        self.active_version = None
        
        # Load Local Final Risk Model (Primary Risk Scorer)
        self._load_primary_model()

        # Load 6A Model (Secondary High-Risk Detector/Warning)
        self.model_dir_6a = os.path.join(ml_dir, "models", "experiment6_model", "6a")
        self.tokenizer_6a = AutoTokenizer.from_pretrained(self.model_dir_6a)
        self.model_6a = MultiTaskLegalModel("nlpaueb/legal-bert-base-uncased", self.meta["num_labels"])
        self.model_6a.load_state_dict(torch.load(os.path.join(self.model_dir_6a, "pytorch_model.bin"), map_location=device))
        self.model_6a = self.model_6a.to(device)
        self.model_6a.eval()

        # Frozen threshold calibrations
        # For final_risk_model: LOW < 41.0, MEDIUM < 60.0, HIGH >= 60.0
        self.th_low_med = 41.0
        self.th_med_high = 60.0
        # For 6A warning: HIGH >= 61.0
        self.th2_6a = 61.0

    def predict_risk(self, text: str):
        self.reload_if_updated()
        # 1. Run Final Local Risk Model (Primary Scorer)
        inputs = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=256, padding=True)
        input_ids = inputs["input_ids"].to(self.device)
        attention_mask = inputs["attention_mask"].to(self.device)
        
        with torch.no_grad():
            _, risk_outputs = self.model(input_ids, attention_mask)
            score = float(risk_outputs.item()) * 100
            
        if score < self.th_low_med:
            pred_level = "low"
        elif score < self.th_med_high:
            pred_level = "medium"
        else:
            pred_level = "high"
            
        # 2. Run 6A Model (Secondary Detector for safety warning)
        inputs_6a = self.tokenizer_6a(text, return_tensors="pt", truncation=True, max_length=256, padding=True)
        input_ids_6a = inputs_6a["input_ids"].to(self.device)
        attention_mask_6a = inputs_6a["attention_mask"].to(self.device)
        
        with torch.no_grad():
            _, risk_6a = self.model_6a(input_ids_6a, attention_mask_6a)
            score_6a = float(risk_6a.item()) * 100
            
        high_risk_warning = (score_6a >= self.th2_6a)
        
        # 3. Disagreement Detection
        requires_contextual_review = False
        if pred_level == "low" and high_risk_warning:
            requires_contextual_review = True
        elif pred_level in ["medium", "high"] and not high_risk_warning and score_6a < 39.0:
            requires_contextual_review = True
            
        return {
            "risk_score": score,
            "risk_level": pred_level,
            "high_risk_warning": high_risk_warning,
            "requires_contextual_review": requires_contextual_review
        }
