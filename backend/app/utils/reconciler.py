import logging
import re

logger = logging.getLogger(__name__)

class RiskReconciler:
    @staticmethod
    def reconcile(local_risk: dict, groq_risk: dict | None) -> dict:
        """
        Reconciles the local ML model's predictions and high-risk safety warning
        with Groq's contextual analysis using a deterministic rule with Groq priority.
        Outputs user-friendly, non-technical plain English explanations and recommendations.
        
        Args:
            local_risk: dict containing local risk_score, risk_level, high_risk_warning, requires_contextual_review
            groq_risk: dict containing final_risk (or risk_label), risk_score, confidence, reasons, issues, recommended_action
            
        Returns:
            dict containing:
              - final_risk_level: "low", "medium", "high"
              - final_risk_score: float (0.0 to 100.0)
              - explanation: str (formatted in user-friendly What this means / Why it matters)
              - recommendation: str (recommendation text without a display heading)
              - local_ml_contribution: dict (scores/labels of local model)
              - groq_contribution: dict
        """
        local_level = local_risk["risk_level"].lower()
        local_score = local_risk["risk_score"]
        has_warning = local_risk["high_risk_warning"]
        
        # Helper to generate static user-facing text when Groq is unavailable
        def get_fallback_texts(level: str) -> tuple[str, str]:
            if level == "high":
                exp = (
                    "What this means:\n"
                    "This clause imposes significant liabilities, waivers, or strict obligations.\n\n"
                    "Why it matters:\n"
                    "This clause is flagged as high-risk because it may create severe liability or lock you into one-sided obligations."
                )
                rec = (
                    "We strongly recommend renegotiating these terms or reviewing them with a legal advisor before signing."
                )
            elif level == "medium":
                exp = (
                    "What this means:\n"
                    "This clause sets forth specific obligations or restrictions.\n\n"
                    "Why it matters:\n"
                    "This clause is flagged as moderate-risk due to potential one-sided conditions or restrictions."
                )
                rec = (
                    "Consider negotiating more balanced terms or clarifying the obligations."
                )
            else:
                exp = (
                    "What this means:\n"
                    "This clause outlines standard contract parameters.\n\n"
                    "Why it matters:\n"
                    "This clause appears reasonable and standard for agreements of this type."
                )
                rec = (
                    "You can generally accept this clause as written."
                )
            return exp, rec

        # If Groq was not queried or is unavailable, use standard user-friendly fallback
        groq_reasons = (groq_risk.get("reasons") or []) if groq_risk else []
        if groq_risk is None or "API Offline" in groq_reasons:
            fallback_exp, fallback_rec = get_fallback_texts(local_level)
            return {
                "final_risk_level": local_level,
                "final_risk_score": local_score,
                "explanation": fallback_exp,
                "recommendation": fallback_rec,
                "local_ml_contribution": {
                    "score": round(local_score, 2),
                    "level": local_level,
                    "warning": has_warning
                },
                "groq_contribution": None
            }
            
        groq_level = (groq_risk.get("risk_label") or groq_risk.get("final_risk")).lower()
        groq_score = groq_risk.get("risk_score")
        if groq_score is None:
            map_score = {"low": 25.0, "medium": 50.0, "high": 75.0}
            groq_score = map_score.get(groq_level, 25.0)
            
        groq_conf = groq_risk.get("confidence", 1.0)
        
        # Reconciliation Logic:
        final_level = groq_level
        escalated = False
        
        if groq_level == "high":
            final_level = "high"
        elif groq_level == "medium":
            if has_warning or local_score >= 80.0:
                final_level = "high"
                escalated = True
        elif groq_level == "low":
            if has_warning and local_score >= 90.0:
                final_level = "high"
                escalated = True
            elif has_warning and local_score >= 70.0:
                final_level = "medium"
                escalated = True
                    
        # Calculate final continuous risk score (80% Groq + 20% Local)
        final_score = 0.8 * groq_score + 0.2 * local_score
        
        # Ensure consistency between score and label
        if final_level == "low":
            final_score = min(final_score, 40.0)
        elif final_level == "medium":
            final_score = max(41.0, min(final_score, 59.9))
        elif final_level == "high":
            final_score = max(60.0, final_score)
            
        # Extract explanation & recommendation from Groq
        raw_explanation = groq_risk.get("explanation") or ""
        raw_recommendation = groq_risk.get("recommendation") or groq_risk.get("recommended_action") or ""
        
        # Clean any debug strings, [Reconciliation], local model, etc. from raw texts
        def clean_technical_jargon(text: str) -> str:
            # Remove [Reconciliation], model names, and references to local safety model
            text = re.sub(r"\[Reconciliation\]", "", text, flags=re.IGNORECASE)
            text = re.sub(r"local safety model", "risk verification checks", text, flags=re.IGNORECASE)
            text = re.sub(r"local model", "risk verification checks", text, flags=re.IGNORECASE)
            text = re.sub(r"safety warning", "risk indicator", text, flags=re.IGNORECASE)
            text = re.sub(r"Groq assessed", "Analysis indicated", text, flags=re.IGNORECASE)
            text = re.sub(r"Groq", "The system", text, flags=re.IGNORECASE)
            return text.strip()
            
        raw_explanation = clean_technical_jargon(raw_explanation)
        raw_recommendation = clean_technical_jargon(raw_recommendation)
        
        # Ensure correct structured layout: What this means / Why it matters
        wtm = "This clause outlines the contract parameters."
        wim = f"This clause appears reasonable and standard for agreements of this type."
        
        # Try to parse the sections from raw_explanation if they exist
        if "what this means:" in raw_explanation.lower() and "why it matters:" in raw_explanation.lower():
            parts = re.split(r"why it matters:", raw_explanation, flags=re.IGNORECASE)
            wtm_part = parts[0].replace("What this means:", "", 1).strip()
            wim_part = parts[1].strip()
            if wtm_part:
                wtm = wtm_part
            if wim_part:
                wim = wim_part
        elif "analysis:" in raw_explanation.lower():
            wtm = raw_explanation.split("Analysis:", 1)[0].strip()
            wim = raw_explanation.split("Analysis:", 1)[1].strip()
        else:
            wtm = "This clause outlines typical contractual terms."
            wim = raw_explanation
            
        # Parse recommendation prefix if present
        rec_val = raw_recommendation
        if "recommendation before signing:" in rec_val.lower():
            rec_val = re.split(r"recommendation before signing:", rec_val, flags=re.IGNORECASE)[1].strip()
            
        # Update Why it matters and Recommendation dynamically if escalated
        if escalated:
            if final_level == "high":
                wim = "Our risk verification checks flagged this clause as high-risk due to potential severe liabilities or one-sided obligations."
                rec_val = "We strongly recommend negotiating this clause to add protective caps/notice periods, or consulting a legal advisor before signing."
            elif final_level == "medium":
                wim = "Our risk verification checks flagged this clause as moderate-risk due to potential one-sided restrictions or obligations."
                rec_val = "Request to clarify the wording, insert a reasonable limit, or balance the obligation before signing."

        # Re-assemble formatted strings
        final_explanation = f"What this means:\n{wtm}\n\nWhy it matters:\n{wim}"
        final_rec = rec_val
        
        return {
            "final_risk_level": final_level,
            "final_risk_score": round(final_score, 2),
            "explanation": final_explanation,
            "recommendation": final_rec,
            "local_ml_contribution": {
                "score": round(local_score, 2),
                "level": local_level,
                "warning": has_warning
            },
            "groq_contribution": {
                "score": round(groq_score, 2),
                "level": groq_level,
                "confidence": round(groq_conf, 2)
            }
        }
