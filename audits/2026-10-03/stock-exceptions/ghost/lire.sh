#!/bin/sh
# Lecture polie du ghost (D-483) : robots.txt puis la page, sous CatwalksBot. Rejouable.
set -e
cd "$(dirname "$0")"
python3 ../_lecture-polie/lire-page.py https://www.ghostfashion.com/careers --motif='openings|vacanc|position' --liens='job|career|vacanc'
