#!/bin/sh
# Lecture polie du rotate (D-483) : robots.txt puis la page, sous CatwalksBot. Rejouable.
set -e
cd "$(dirname "$0")"
python3 ../_lecture-polie/lire-page.py https://www.rotatebirgerchristensen.com/career --motif='intern$|copenhagen|June 2026|unpaid|un-paid|non-paid|send your' --liens='career|job'
