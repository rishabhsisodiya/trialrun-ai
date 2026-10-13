import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from importer import import_transactions  # noqa: E402
from ledger import Ledger  # noqa: E402

HEADER = "id,account,amount,date\n"


class ExistingBehaviour(unittest.TestCase):
    def test_imports_every_valid_row(self):
        ledger = Ledger()
        result = import_transactions(HEADER + "t-1,acc-7,12.50,2026-03-01\nt-2,acc-9,4.00,2026-03-01\n", ledger)
        self.assertEqual(result["imported"], 2)
        self.assertEqual(len(ledger.transactions), 2)


# ---- The tests below describe the new behaviour and fail until it is built. ----


class ExactMoney(unittest.TestCase):
    def test_balance_is_exact_cents(self):
        ledger = Ledger()
        import_transactions(HEADER + "t-1,acc-7,0.10,2026-03-01\nt-2,acc-7,0.20,2026-03-01\n", ledger)
        self.assertEqual(ledger.balance("acc-7"), 30)
        self.assertIsInstance(ledger.balance("acc-7"), int)

    def test_reads_separators_signs_and_currency(self):
        ledger = Ledger()
        rows = 't-1,acc-7,"1,234.56",2026-03-01\nt-2,acc-7,-3.10,2026-03-01\nt-3,acc-7,$5,2026-03-01\n'
        import_transactions(HEADER + rows, ledger)
        self.assertEqual([t["amount_cents"] for t in ledger.transactions], [123456, -310, 500])


class Repeatable(unittest.TestCase):
    def test_importing_the_same_file_twice_adds_nothing(self):
        ledger = Ledger()
        text = HEADER + "t-1,acc-7,12.50,2026-03-01\nt-2,acc-7,1.00,2026-03-01\n"
        import_transactions(text, ledger)
        second = import_transactions(text, ledger)
        self.assertEqual(second["imported"], 0)
        self.assertEqual(second["skipped"], 2)
        self.assertEqual(ledger.balance("acc-7"), 1350)


class BadRows(unittest.TestCase):
    def test_a_bad_amount_is_reported_and_the_rest_is_imported(self):
        ledger = Ledger()
        text = HEADER + "t-1,acc-7,12.50,2026-03-01\nt-2,acc-7,twelve,2026-03-01\nt-3,acc-7,1.00,2026-03-02\n"
        result = import_transactions(text, ledger)
        self.assertEqual(result["imported"], 2)
        self.assertEqual([error["line"] for error in result["errors"]], [3])
        self.assertTrue(result["errors"][0]["reason"])
        self.assertEqual(ledger.balance("acc-7"), 1350)

    def test_a_clean_file_reports_no_errors(self):
        result = import_transactions(HEADER + "t-1,acc-7,12.50,2026-03-01\n", Ledger())
        self.assertEqual(result, {"imported": 1, "skipped": 0, "errors": []})


if __name__ == "__main__":
    unittest.main()
