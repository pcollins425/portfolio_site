"""Expectation chart for a theme: month of life, bands, and response clocks."""

from datetime import date
import unittest

from app.theme_performance import build_expectation


def _month(year, month):
    return date(year, month, 1)


def _stint(slot, theme, start, rmvl=None, action="INSTALL", asset="AST-1", casino="CAS-1"):
    return {
        "slot_master_id": slot,
        "asset_id": asset,
        "casino_id": casino,
        "theme_id": theme,
        "action": action,
        "rmvl_date": rmvl,
        "lastconver": start if action in ("CONVERT", "UPGRADE") else None,
        "golive001": None if action in ("CONVERT", "UPGRADE") else start,
        "date_instl": start,
    }


def _row(slot, when, index, days=30):
    return {
        "slot_master_id": slot,
        "report_date": when,
        "win_index": index,
        "days_on_floor": days,
    }


class ThemePerformanceTests(unittest.TestCase):
    def test_short_opening_month_does_not_start_the_life(self):
        stints = [_stint("SMM-1", "TH-1", _month(2024, 1))]
        months = [
            _row("SMM-1", _month(2024, 1), 2.4, days=4),
            _row("SMM-1", _month(2024, 2), 1.6, days=28),
            _row("SMM-1", _month(2024, 3), 1.2, days=30),
        ]
        result = build_expectation(stints, months, "TH-1")
        self.assertEqual(result["months"][0]["median"], 1.6)
        self.assertEqual(result["months"][1]["median"], 1.2)
        self.assertEqual(result["months"][0]["month"], 1)

    def test_median_and_middle_half_across_placements(self):
        stints = [
            _stint("SMM-1", "TH-1", _month(2024, 1), asset="AST-1"),
            _stint("SMM-2", "TH-1", _month(2024, 1), asset="AST-2"),
            _stint("SMM-3", "TH-1", _month(2024, 1), asset="AST-3"),
            _stint("SMM-4", "TH-1", _month(2024, 1), asset="AST-4"),
        ]
        months = []
        for slot, index in (("SMM-1", 1.0), ("SMM-2", 2.0), ("SMM-3", 3.0), ("SMM-4", 4.0)):
            months.append(_row(slot, _month(2024, 1), index))
        result = build_expectation(stints, months, "TH-1")
        point = result["months"][0]
        self.assertEqual(point["n"], 4)
        self.assertEqual(point["median"], 2.5)
        self.assertEqual(point["low"], 1.75)
        self.assertEqual(point["high"], 3.25)

    def test_two_warning_months_start_the_clock_and_remove_stops_it(self):
        stints = [_stint("SMM-1", "TH-1", _month(2024, 1), rmvl=_month(2024, 7))]
        indexes = [1.4, 0.9, 0.85, 0.6, 0.5, 0.55, 0.5]
        months = [_row("SMM-1", _month(2024, i + 1), indexes[i]) for i in range(7)]
        result = build_expectation(stints, months, "TH-1")
        text = " ".join(result["summary"])
        self.assertIn("about 4 months after warning (1 placement)", text)
        self.assertIn("about 2 months after dead (1 placement)", text)
        self.assertIn("Most endings are a cabinet pull.", text)

    def test_one_soft_month_does_not_start_warning(self):
        stints = [_stint("SMM-1", "TH-1", _month(2024, 1), rmvl=_month(2024, 4))]
        months = [
            _row("SMM-1", _month(2024, 1), 1.4),
            _row("SMM-1", _month(2024, 2), 0.9),
            _row("SMM-1", _month(2024, 3), 1.3),
            _row("SMM-1", _month(2024, 4), 1.2),
        ]
        result = build_expectation(stints, months, "TH-1")
        text = " ".join(result["summary"])
        self.assertNotIn("after warning", text)
        self.assertIn("Most endings are a cabinet pull.", text)

    def test_theme_swap_beats_a_later_remove(self):
        stints = [
            _stint("SMM-1", "TH-1", _month(2024, 1), rmvl=_month(2024, 8)),
            _stint("SMM-2", "TH-9", _month(2024, 5), action="CONVERT", asset="AST-1"),
        ]
        months = [_row("SMM-1", _month(2024, i), 1.4) for i in range(1, 8)]
        result = build_expectation(stints, months, "TH-1")
        self.assertEqual(result["months"][-1]["month"], 5)
        text = " ".join(result["summary"])
        self.assertIn("Most endings are a theme swap.", text)
        self.assertNotIn("cabinet pull", text)

    def test_move_stays_one_life_and_a_later_install_is_another(self):
        stints = [
            _stint("SMM-1", "TH-1", _month(2023, 1), asset="AST-1"),
            _stint("SMM-2", "TH-1", _month(2023, 4), action="MOVE", asset="AST-1"),
            _stint("SMM-3", "TH-1", _month(2023, 1), rmvl=_month(2023, 3), asset="AST-2"),
            _stint("SMM-4", "TH-1", _month(2023, 6), asset="AST-2"),
        ]
        months = [
            _row("SMM-1", _month(2023, 1), 1.5),
            _row("SMM-1", _month(2023, 2), 1.4),
            _row("SMM-1", _month(2023, 3), 1.3),
            _row("SMM-2", _month(2023, 4), 1.2),
            _row("SMM-3", _month(2023, 1), 0.4),
            _row("SMM-4", _month(2023, 6), 1.8),
        ]
        result = build_expectation(stints, months, "TH-1")
        self.assertEqual(result["placements"], 3)
        by_month = {p["month"]: p["n"] for p in result["months"]}
        self.assertEqual(by_month[1], 3)
        self.assertEqual(by_month[4], 1)

    def test_missing_month_breaks_the_two_month_run(self):
        stints = [_stint("SMM-1", "TH-1", _month(2024, 1), rmvl=_month(2024, 5))]
        months = [
            _row("SMM-1", _month(2024, 1), 0.8),
            _row("SMM-1", _month(2024, 3), 0.8),
            _row("SMM-1", _month(2024, 4), 0.8),
            _row("SMM-1", _month(2024, 5), 0.8),
        ]
        result = build_expectation(stints, months, "TH-1")
        text = " ".join(result["summary"])
        self.assertIn("after warning", text)
        self.assertIn("(1 placement)", text)

    def test_recovering_above_house_clears_the_clock(self):
        stints = [_stint("SMM-1", "TH-1", _month(2024, 1), rmvl=_month(2024, 6))]
        months = [
            _row("SMM-1", _month(2024, 1), 0.8),
            _row("SMM-1", _month(2024, 2), 0.8),
            _row("SMM-1", _month(2024, 3), 1.4),
            _row("SMM-1", _month(2024, 4), 1.3),
            _row("SMM-1", _month(2024, 5), 1.2),
            _row("SMM-1", _month(2024, 6), 1.2),
        ]
        result = build_expectation(stints, months, "TH-1")
        text = " ".join(result["summary"])
        self.assertNotIn("after warning", text)


if __name__ == "__main__":
    unittest.main()
