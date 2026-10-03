#!/bin/sh
# Lecture polie du sioux (D-483) : robots.txt puis la page, sous CatwalksBot. Rejouable.
set -e
cd "$(dirname "$0")"
python3 ../_lecture-polie/lire-page.py https://www.sioux.de/pages/stellenangebote --motif='offene Stellen|Stellenangebot' --liens='job|stellen|karriere|career'
