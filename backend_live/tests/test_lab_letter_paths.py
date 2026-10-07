"""Analytics path for a lab letter indexed from Q:."""

import unittest

from app.document_paths import lab_letter_serve_path


class LabLetterPathTests(unittest.TestCase):
    def test_q_index_path_lands_under_compliance(self):
        stored = (
            "Lab Letters/California/AGS/Themes/"
            "Pinata Pays Grande Fun Fun Fiesta/"
            "CA.Lab.AGS.Pinata Pays Grande - Fun Fun Fiesta.pdf"
        )
        self.assertEqual(
            lab_letter_serve_path(stored),
            "Compliance/" + stored,
        )

    def test_compliance_path_is_unchanged(self):
        stored = "Compliance/Lab Letters/California/AGS/Themes/Theme/letter.pdf"
        self.assertEqual(lab_letter_serve_path(stored), stored)

    def test_other_folders_are_rejected(self):
        with self.assertRaises(ValueError):
            lab_letter_serve_path("Par Sheets/AGS/Theme/sheet.pdf")


if __name__ == "__main__":
    unittest.main()
