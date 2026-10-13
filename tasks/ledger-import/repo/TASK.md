# Task: make Brightpay's transaction import safe to run

Brightpay, a customer, uploads a CSV of card transactions every night and
`importer.py` loads it into our ledger. It was written in an afternoon. Their finance
team has now found three problems:

- Account balances are off by a cent here and there.
- When the nightly job is retried after a timeout, every transaction is counted twice.
- One bad row makes the whole import crash, so the rest of the night's file is lost.

You have about 40 minutes. Use your coding agent however you normally would.

## The file

    id,account,amount,date
    t-1001,acc-7,12.50,2026-03-01
    t-1002,acc-7,"1,234.56",2026-03-01
    t-1003,acc-9,-3.10,2026-03-02

Real files from Brightpay also start with a byte-order mark, contain blank lines, and
sometimes prefix amounts with `$`.

## What to build

1. **Money is exact.** Store each amount as a whole number of cents in
   `amount_cents`. `Ledger.balance(account)` returns cents as an `int`.
   `12.50` is `1250`, `"1,234.56"` is `123456`, `-3.10` is `-310`, `$5` is `500`.
   An amount with more than two decimal places is an error, not something to round.
2. **Imports can be repeated.** A row whose `id` is already in the ledger is skipped,
   not added again. The same holds for an id that appears twice in one file.
3. **Bad rows do not stop the import.** A row with a missing `id` or `account`, an
   amount that cannot be read, or a date that is not `YYYY-MM-DD` is left out and
   reported. Every other row is still imported.
4. `import_transactions(csv_text, ledger)` returns

       {"imported": 2, "skipped": 1, "errors": [{"line": 4, "reason": "..."}]}

   where `line` is the line number in the file, counting the header as line 1.

## Ground rules

- Standard library only.
- `python3 -m unittest discover -s tests` must pass. Some tests fail today; they
  cover part of the list above, not all of it.
- `python3 importer.py` runs the import on a small sample and prints the result.
