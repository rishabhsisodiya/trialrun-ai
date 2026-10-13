import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data import DATASET, DOCUMENTS  # noqa: E402
from retrieval import evaluate, rank, recall_at_k, reciprocal_rank, tokenize  # noqa: E402


class ExistingBehaviour(unittest.TestCase):
    def test_rank_returns_at_most_k_ids(self):
        self.assertLessEqual(len(rank("refund policy", DOCUMENTS, k=2)), 2)

    def test_evaluate_reports_both_metrics(self):
        self.assertEqual(set(evaluate(DATASET, DOCUMENTS)), {"recall_at_k", "mrr"})


# ---- The tests below describe the new behaviour and fail until it is built. ----


class Metrics(unittest.TestCase):
    def test_recall_is_the_share_of_relevant_documents_found(self):
        self.assertAlmostEqual(recall_at_k(["a", "b", "c"], ["a", "x"], k=3), 0.5)
        self.assertAlmostEqual(recall_at_k(["a", "b", "c"], ["a"], k=3), 1.0)

    def test_recall_only_counts_the_first_k(self):
        self.assertAlmostEqual(recall_at_k(["x", "y", "a"], ["a"], k=2), 0.0)

    def test_reciprocal_rank_is_one_based(self):
        self.assertAlmostEqual(reciprocal_rank(["a", "b"], ["a"]), 1.0)
        self.assertAlmostEqual(reciprocal_rank(["x", "a"], ["a"]), 0.5)
        self.assertAlmostEqual(reciprocal_rank(["x", "y", "a"], ["a"]), 1 / 3)


class Tokenisation(unittest.TestCase):
    def test_lowercases_and_drops_punctuation(self):
        self.assertEqual(tokenize("How do I get a Refund?"), ["how", "do", "i", "get", "a", "refund"])


class Ranking(unittest.TestCase):
    def test_punctuation_does_not_hide_a_match(self):
        self.assertEqual(rank("refund?", {"d1": "Refund policy.", "d2": "Shipping times."}, k=2), ["d1"])

    def test_rare_terms_outweigh_common_ones(self):
        documents = {
            "d1": "the the the the cat",
            "d2": "the dog",
            "d3": "the bird",
            "d4": "zebra",
        }
        # "the" is in three of four documents; "zebra" is in one, so it must win.
        self.assertEqual(rank("the zebra", documents, k=1), ["d4"])

    def test_equal_scores_are_ordered_by_id(self):
        documents = {"b": "refund", "a": "refund", "c": "refund"}
        self.assertEqual(rank("refund", documents, k=3), ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
