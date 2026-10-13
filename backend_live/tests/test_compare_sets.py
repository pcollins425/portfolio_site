"""Set comparison on the performance page. Pure rows, no database."""

import unittest

from app.casino_month_matrix import (
    CompareError,
    _classify_compare_row,
    compare_rows,
    denom_class,
    list_values,
    member_rows,
)


def _row(**kwargs):
    base = {
        "ym": "2026-09",
        "theme_id": None,
        "theme": "Devil's Lock",
        "cabinet": "Beacon+",
        "vendor": "Bluberi",
        "casino_id": "CT-1",
        "casino": "Downstream",
        "region": "South",
        "smm": "SMM-1",
        "serial": "100",
        "sign": None,
        "sign_bank": None,
        "sign_bank_label": None,
        "denom_class": "single",
        "theo": 1.2,
    }
    base.update(kwargs)
    return base


class DenomClassTests(unittest.TestCase):
    def test_blank_stays_out(self):
        for raw in (None, "", "  ", "nan", "NaN", "n/a", "not-a-denom"):
            self.assertIsNone(denom_class(raw))

    def test_single_and_multi(self):
        self.assertEqual(denom_class("0.01"), "single")
        self.assertEqual(denom_class("$1"), "single")
        self.assertEqual(denom_class("0.01/0.02/0.05/0.10/"), "multi")
        self.assertEqual(denom_class(".01/.02"), "multi")
        self.assertEqual(denom_class("1/2/5/10/25/50/100"), "multi")


class CompareTests(unittest.TestCase):
    def test_unmarked_seat_counts_as_no_sign(self):
        raw = {
            "ym": "2026-09",
            "theme": "Devil's Lock",
            "casino_id": "CT-1",
            "casino": "Downstream",
            "smm": "SMM-9",
            "serial": "200",
            "theo": 0.5,
            "denom": "0.01",
        }
        unmarked = _classify_compare_row(raw, {})
        self.assertEqual(unmarked["sign"], "without")
        marked = _classify_compare_row(
            raw,
            {"SMM-9": {"ssm": "SSM-1", "sign_serial": "143906"}},
        )
        self.assertEqual(marked["sign"], "with")
        self.assertEqual(marked["sign_bank"], "SSM-1")

        rows = [
            _row(sign="with", theo=1.4, serial="100"),
            _row(sign="with", theo=1.0, serial="101", smm="SMM-2"),
            _row(sign="without", theo=0.5, serial="200", smm="SMM-3"),
            _row(
                theme="Other",
                theme_id="TH-9",
                sign="with",
                theo=2.0,
                serial="300",
                smm="SMM-4",
            ),
        ]
        values = list_values(rows, "sign", "theme", "name:Devil's Lock")
        self.assertEqual(values[0]["unit_months"], 2)
        self.assertEqual(values[1]["unit_months"], 1)

        result = compare_rows(rows, "sign", "with", "without", "theme", "name:Devil's Lock")
        signed, unsigned = result["sides"]
        self.assertEqual(signed["theo_index"], 1.2)
        self.assertEqual(unsigned["theo_index"], 0.5)
        self.assertEqual(unsigned["note"], "Under 6 unit-months.")

    def test_theme_hold_uses_theme_id(self):
        rows = [
            _row(theme_id="TH-1", theme="Devil's Lock", denom_class="single", theo=1.0),
            _row(theme_id="TH-1", theme="Devil's Lock", denom_class="multi", theo=1.5, serial="101"),
            _row(theme_id="TH-2", theme="Devil's Lock", denom_class="single", theo=0.4, serial="102"),
        ]
        result = compare_rows(rows, "denom", "single", "multi", "theme", "TH-1")
        single, multi = result["sides"]
        self.assertEqual(single["unit_months"], 1)
        self.assertEqual(single["theo_index"], 1.0)
        self.assertEqual(multi["theo_index"], 1.5)
        self.assertTrue(single["thin"])

    def test_two_themes_and_members(self):
        rows = [
            _row(theme_id="TH-1", theme="Devil's Lock", theo=1.1, serial="100"),
            _row(theme_id="TH-2", theme="Shark's Lock", theo=0.9, serial="200", smm="SMM-2"),
        ]
        result = compare_rows(rows, "theme", "TH-1", "TH-2")
        self.assertEqual(result["sides"][0]["label"], "Devil's Lock")
        self.assertEqual(result["sides"][1]["theo_index"], 0.9)
        members = member_rows(rows, "theme", "TH-2")
        self.assertEqual(members["casinos"][0]["serials"][0]["serial"], "200")

    def test_refuses_same_side_and_same_hold(self):
        rows = [_row()]
        with self.assertRaises(CompareError):
            compare_rows(rows, "theme", "TH-1", "TH-1")
        with self.assertRaises(CompareError):
            list_values(rows, "theme", "theme", "TH-1")


if __name__ == "__main__":
    unittest.main()
