"""Our ledger of customer transactions. In production this is a database table."""


class Ledger:
    def __init__(self):
        self.transactions = []

    def add(self, transaction):
        """Records one transaction: a dict with id, account, amount and date."""
        self.transactions.append(transaction)

    def balance(self, account):
        """The sum of every transaction on an account."""
        return sum(t["amount"] for t in self.transactions if t["account"] == account)
