"""Nightly import of Brightpay's transaction file."""

import csv
import io

from ledger import Ledger


def import_transactions(csv_text, ledger):
    """Loads every row of the CSV into the ledger and reports how many were imported."""
    reader = csv.DictReader(io.StringIO(csv_text))
    imported = 0
    for row in reader:
        ledger.add(
            {
                "id": row["id"],
                "account": row["account"],
                "amount": float(row["amount"]),
                "date": row["date"],
            }
        )
        imported += 1
    return {"imported": imported}


SAMPLE = """id,account,amount,date
t-1001,acc-7,12.50,2026-03-01
t-1002,acc-7,0.10,2026-03-01
t-1003,acc-7,0.20,2026-03-02
"""

if __name__ == "__main__":
    sample_ledger = Ledger()
    print(import_transactions(SAMPLE, sample_ledger))
    print("acc-7 balance:", sample_ledger.balance("acc-7"))
