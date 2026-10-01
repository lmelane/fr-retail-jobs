"""D-496 — la préparation de la base de villes (scripts/geo/villes.py), sur des fichiers GeoNames synthétiques.

Aucune base ni réseau : le chargement (psql) est éprouvé par les témoins de l'API sur base jetable ; ici, ce que le
script ÉCRIT à partir des fichiers de la source, et la transaction qu'il enverrait.
"""
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'geo' / 'villes.py'
spec = importlib.util.spec_from_file_location('villes', SCRIPT)
villes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(villes)


def ligne_ville(gid, nom, pays, a1, a2, pop, fc='PPL', alternatifs=''):
    champs = [str(gid), nom, nom, alternatifs, '48.8', '2.3', 'P', fc, pays, '', a1, a2, '', '', str(pop), '', '35', 'Europe/Paris', '2026-10-01']
    return '\t'.join(champs)


def ligne_nom(nid, gid, langue, nom, prefere='', court='', familier='', historique=''):
    return '\t'.join([str(nid), str(gid), langue, nom, prefere, court, familier, historique, '', ''])


class PreparationTests(unittest.TestCase):
    def preparer(self):
        self.tmp = tempfile.TemporaryDirectory()
        cache = Path(self.tmp.name)
        villes_txt = '\n'.join([
            ligne_ville(2988507, 'Paris', 'FR', '11', '75', 2138551, 'PPLC', 'Lutece,Parigi'),
            ligne_ville(2970479, 'Paris 15 Vaugirard', 'FR', '11', '75', 229713),
            ligne_ville(2970481, 'Paris 13 Gobelins', 'FR', '11', '75', 181271),
            ligne_ville(6618620, 'Paris 13e Arrondissement', 'FR', '11', '75', 177833, 'PPLX'),
            ligne_ville(8504417, 'La Defense', 'FR', '11', '92', 20000, 'PPLX', 'La Défense'),
            ligne_ville(1, 'Ville Disparue', 'FR', '11', '75', 900, 'PPLH'),
            ligne_ville(2867714, 'Munich', 'DE', '02', '091', 1505005, 'PPLA', 'Muenchen,München'),
            ligne_ville(3143244, 'Oslo', 'NO', '12', '0301', 580000, 'PPLC'),
            ligne_ville(2656295, 'London Borough of Bexley', 'GB', 'ENG', 'GLA', 248287, 'PPLA3'),
        ]) + '\n'
        with zipfile.ZipFile(cache / 'cities500.zip', 'w') as z:
            z.writestr('cities500.txt', villes_txt)
        (cache / 'admin1CodesASCII.txt').write_text('FR.11\tÎle-de-France\tIle-de-France\t3012874\nDE.02\tBavaria\tBavaria\t2951839\n', encoding='utf8')
        noms = '\n'.join([
            ligne_nom(1, 2867714, 'de', 'Muenchen'),
            ligne_nom(2, 2867714, 'de', 'München', prefere='1'),
            ligne_nom(3, 2867714, 'fr', 'Munich'),  # identique au nom principal : non écrit
            ligne_nom(4, 2988507, 'it', 'Parigi'),
            ligne_nom(5, 2988507, 'en', 'City of Light', familier='1'),
            ligne_nom(6, 3143244, 'no', 'Christiania', historique='1'),
            ligne_nom(7, 3143244, 'no', 'Oslo by'),
            ligne_nom(8, 2988507, 'xx', 'Hors langue'),
            ligne_nom(9, 2951839, 'de', 'Bayern'),
            ligne_nom(10, 2951839, 'fr', 'Bavière'),
            ligne_nom(11, 2951839, 'de', 'Königreich Bayern', historique='1'),
            ligne_nom(12, 3143244, 'en', 'Oslo County Borough'),
        ]) + '\n'
        with zipfile.ZipFile(cache / 'alternateNamesV2.zip', 'w') as z:
            z.writestr('alternateNamesV2.txt', noms)
        (cache / 'readme.txt').write_text('licence CC BY 4.0', encoding='utf8')
        postaux = '\n'.join([
            '\t'.join(['FR', '94430', 'Chennevières-sur-Marne', 'Île-de-France', '11', 'Val-de-Marne', '94', '', '', '48.7975', '2.5397', '5']),
            '\t'.join(['FR', '94430', 'Chennevières-sur-Marne', 'Île-de-France', '11', 'Val-de-Marne', '94', '', '', '48.7975', '2.5397', '5']),
            '\t'.join(['US', '10001', 'New York', 'New York', 'NY', 'New York', '061', '', '', '40.7484', '-73.9967', '4']),
            '\t'.join(['FR', '75009', 'Paris 09', 'Île-de-France', '11', 'Paris', '75', '', '', '48.8718', '2.3399', '5']),
            '\t'.join(['FR', '94431', 'Chennevières-sur-Marne CEDEX', 'Île-de-France', '11', 'Val-de-Marne', '94', '', '', '48.797', '2.5405', '5']),
            '\t'.join(['FR', '75021 CEDEX 01', 'Paris 01', 'Île-de-France', '11', 'Paris', '75', '', '', '48.8592', '2.3417', '5']),
            '\t'.join(['DE', '80331', 'München', 'Bayern', 'BY', '', '', '', '', '48.1372', '11.5755', '4']),
        ]) + '\n'
        with zipfile.ZipFile(cache / 'postaux-allCountries.zip', 'w') as z:
            z.writestr('allCountries.txt', postaux)
        (cache / 'postaux-readme.txt').write_text('licence CC BY 4.0', encoding='utf8')
        manifeste = villes.preparer(cache, sans_libelles=False)
        lire = lambda nom: [l.split('\t') for l in (cache / 'charge' / nom).read_text(encoding='utf8').splitlines()]
        self.subdivisions = lire('subdivisions.tsv')
        self.postaux = lire('postaux.tsv')
        return manifeste, lire('villes.tsv'), lire('noms.tsv'), lire('libelles.tsv')

    def tearDown(self):
        self.tmp.cleanup()

    def test_villes_retenues_et_arrondissements(self):
        _m, v, _n, _l = self.preparer()
        par_id = {int(r[0]): r for r in v}
        self.assertNotIn(1, par_id, 'un lieu historique (PPLH) est écarté')
        # D-499 : un arrondissement est un lieu proposé, affiché comme Indeed ; un doublon de GeoNames ne l'est pas.
        self.assertEqual(par_id[2970479][1:2] + par_id[2970479][10:11], ['Paris 15e', 't'])
        self.assertEqual([par_id[2970481][1], par_id[2970481][10]], ['Paris 13e', 't'])
        self.assertEqual([par_id[6618620][1], par_id[6618620][10]], ['Paris 13e', 'f'])
        self.assertEqual(par_id[2988507][10], 't')
        self.assertEqual(par_id[2656295][10], 'f', 'un borough de Londres n\'est pas une ville à proposer')
        # Un quartier reste proposable : la suggestion ne le montre que s'il porte des offres (apps/api/lib/suggestions.ts).
        self.assertEqual(par_id[8504417][10], 't')
        self.assertEqual(par_id[2988507][5], 'Île-de-France')
        self.assertEqual(par_id[3143244][5], '\\N', 'subdivision inconnue : NULL')

    def test_noms_et_libelles(self):
        m, _v, n, l = self.preparer()
        self.assertIn(['2867714', 'DE', 'München', 'f'], n)
        self.assertIn(['2988507', 'FR', 'Paris', 't'], n)
        libelles = {(r[0], r[1]): r[2] for r in l}
        self.assertEqual(libelles[('2867714', 'de')], 'München', 'le nom préféré passe devant le premier rencontré')
        self.assertNotIn(('2867714', 'fr'), libelles, 'un libellé identique au nom principal n\'est pas écrit')
        self.assertEqual(libelles[('2988507', 'it')], 'Parigi')
        self.assertNotIn(('2988507', 'en'), libelles, 'un nom familier n\'est pas un libellé')
        self.assertEqual(libelles[('3143244', 'nb')], 'Oslo by', '« no » est lu pour « nb », un nom historique écarté')
        self.assertNotIn(('3143244', 'en'), libelles, 'un nom d\'entité administrative n\'est pas un nom d\'usage')
        self.assertEqual(m['licence'], 'CC BY 4.0')
        self.assertIn('GeoNames', m['attribution'])
        self.assertEqual(m['villes'], 8)
        self.assertIn(['2970479', 'FR', 'Paris 15', 't'], n, 'la clé « paris 15 » désigne le 15e')
        self.assertEqual(set(m['fichiers']), {'cities500.zip', 'admin1CodesASCII.txt', 'alternateNamesV2.zip', 'readme.txt',
                                              'postaux-allCountries.zip', 'postaux-readme.txt'})

    def test_codes_postaux(self):
        m, *_ = self.preparer()
        self.assertEqual(self.postaux, [
            ['FR', '94430', 'Chennevières-sur-Marne', '94', '48.7975', '2.5397'],
            ['US', '10001', 'New York', 'NY', '40.7484', '-73.9967'],
            ['FR', '75009', 'Paris 9e', '75', '48.8718', '2.3399'],
            ['DE', '80331', 'München', '\\N', '48.1372', '11.5755'],
        ], 'un doublon retiré ; la subdivision affichée : département (FR), État (US), aucune ailleurs')
        self.assertEqual(m['postaux'], 4)

    def test_noms_des_regions(self):
        self.preparer()
        self.assertEqual(sorted(self.subdivisions), [['DE', '02', 'Bavière'], ['DE', '02', 'Bayern']],
                         'les noms de la région dans les langues de l\'interface, sans les noms historiques')

    def test_transaction_a_blanc_ou_ecrite(self):
        m, *_ = self.preparer()
        dossier = Path(self.tmp.name) / 'charge'
        a_blanc = villes.sql_chargement(dossier, m, ecrire=False, forcer=False)
        ecrit = villes.sql_chargement(dossier, m, ecrire=True, forcer=False)
        self.assertIn('\nROLLBACK;', a_blanc)
        self.assertNotIn('\nCOMMIT;', a_blanc)
        self.assertIn('\nCOMMIT;', ecrit)
        # Les deux gardes : un fichier tronqué, un retrait massif (levé seulement par --forcer).
        self.assertIn(f'< {villes.VILLES_MIN}', ecrit)
        self.assertIn('IF true AND', ecrit)
        self.assertIn('IF false AND', villes.sql_chargement(dossier, m, ecrire=True, forcer=True))


if __name__ == '__main__':
    unittest.main()
