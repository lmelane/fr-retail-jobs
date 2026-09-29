"""Market boundary regressions for the read-only Railway measurement tool."""
import unittest
from railway import market_scopes, scope_evidence


class MarketScopeTest(unittest.TestCase):
    def setUp(self):
        self.scopes = market_scopes({'marches': [
            {'code': 'FR', 'pays': ['FR', 'MC']},
            {'code': 'US', 'pays': ['US']},
        ]})

    def test_monaco_belongs_to_the_declared_french_market(self):
        body = {'perimetre': {'code': 'FR', 'pays': ['FR', 'MC']},
                'jobs': [{'countryCode': 'FR'}, {'countryCode': 'MC'}]}
        proof = scope_evidence(body, 'FR', self.scopes)
        self.assertTrue(proof['scopeMatchesContract'])
        self.assertEqual(proof['outsideMarket'], 0)

    def test_real_foreign_and_missing_countries_remain_failures(self):
        body = {'perimetre': {'code': 'FR', 'pays': ['FR', 'MC']},
                'jobs': [{'countryCode': 'US'}, {'countryCode': None}]}
        proof = scope_evidence(body, 'FR', self.scopes)
        self.assertEqual(proof['outsideMarket'], 2)
        self.assertEqual(proof['outsideMarketCountries'], ['<missing>', 'US'])

    def test_jobs_cannot_expand_the_registry_scope(self):
        body = {'perimetre': {'code': 'US', 'pays': ['US', 'FR']},
                'jobs': [{'countryCode': 'FR'}]}
        proof = scope_evidence(body, 'US', self.scopes)
        self.assertFalse(proof['scopeMatchesContract'])
        self.assertEqual(proof['outsideMarket'], 1)

    def test_missing_registry_never_becomes_a_single_country_fallback(self):
        for contract in [{}, {'marches': []}, {'marches': [{'code': 'FR', 'pays': []}]}]:
            with self.subTest(contract=contract):
                with self.assertRaises(ValueError):
                    market_scopes(contract)
