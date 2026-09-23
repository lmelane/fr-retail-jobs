"""Metric regressions; no database or catalogue needed."""
import unittest
from evaluate import quality


class QualityTest(unittest.TestCase):
    def test_missing_judgment_is_not_a_negative(self):
        result = quality(['known', 'unknown'], {'known': 2})
        self.assertIsNone(result['precisionAtAvailable20'])
        self.assertIsNone(result['ndcgAt20'])
        self.assertEqual(result['pooledRecallAt100'], 1)

    def test_empty_with_known_positive_is_a_failure(self):
        result = quality([], {'missed': 2})
        self.assertEqual(result['precisionAtAvailable20'], 0)
        self.assertEqual(result['ndcgAt20'], 0)
        self.assertEqual(result['pooledRecallAt100'], 0)

    def test_empty_without_known_positive_cannot_establish_recall(self):
        result = quality([], {'irrelevant': 0})
        self.assertIsNone(result['ndcgAt20'])
        self.assertIsNone(result['pooledRecallAt100'])

    def test_graded_ranking_and_bounded_recall(self):
        result = quality(['partial', 'best'], {'best': 2, 'partial': 1, 'missed': 2})
        self.assertEqual(result['precisionAtAvailable20'], 1)
        self.assertEqual(result['strictPrecisionAtAvailable20'], .5)
        self.assertLess(result['ndcgAt20'], 1)
        self.assertAlmostEqual(result['pooledRecallAt100'], 2/3)


if __name__ == '__main__':
    unittest.main()
