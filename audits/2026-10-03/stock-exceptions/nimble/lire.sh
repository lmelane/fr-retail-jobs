#!/bin/sh
# Lecture polie du nimble (D-483) : robots.txt puis la page, sous CatwalksBot. Rejouable.
set -e
cd "$(dirname "$0")"
python3 ../_lecture-polie/lire-page.py https://nimbleactivewear.com/pages/careers --motif='job|growing|product developer' --liens='^/pages/(?!careers)'
sleep 2
python3 ../_lecture-polie/lire-page.py https://nimbleactivewear.com/pages/product-developer --motif='^Product Developer|location|sydney|melbourne|australia|survey'
