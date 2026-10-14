from app.utils.reconciler import RiskReconciler


def _local_risk():
    return {"risk_level": "low", "risk_score": 18, "high_risk_warning": False}


def test_fallback_recommendation_does_not_repeat_its_ui_heading():
    result = RiskReconciler.reconcile(_local_risk(), None)
    assert result["recommendation"]
    assert not result["recommendation"].lower().startswith("recommendation before signing:")


def test_ai_recommendation_prefix_is_removed_from_display_text():
    result = RiskReconciler.reconcile(
        _local_risk(),
        {
            "risk_label": "medium",
            "risk_score": 50,
            "confidence": 0.9,
            "explanation": "What this means: Payment terms apply. Why it matters: Timing could be unclear.",
            "recommendation": "Recommendation before signing: Clarify the payment due date.",
        },
    )
    assert result["recommendation"] == "Clarify the payment due date."
