from backend.app.analytics import build_comparison, list_metrics


def build_analytics_catalogue(bundle: dict) -> dict:
    analyses = []
    for metric in list_metrics(bundle):
        first_by_year = {}
        for base in metric["base_periods"]:
            first_by_year.setdefault(base[:4], base)
        bases = sorted(set(first_by_year.values()) | (
            {metric["default_base_period"]} if metric["default_base_period"] in metric["base_periods"] else set()
        ))
        scenarios = [
            build_comparison(
                bundle, metric["metric"], indicator=metric.get("indicator"), base_period=base,
            )
            for base in bases
        ]
        analyses.append({
            "key": metric["id"],
            "metric": metric["metric"],
            "indicator": metric.get("indicator"),
            "title": metric["title"],
            "frequency": metric["frequency"],
            "unit": metric["unit"],
            "components": metric["components"],
            "default_base": metric["default_base_period"],
            "available_bases": bases,
            "scenarios": scenarios,
        })
    return {
        "schema_version": 1,
        "exported_at": bundle["exported_at"],
        "alignment": "Common base and end periods for all three Baltic countries.",
        "analyses": analyses,
    }
