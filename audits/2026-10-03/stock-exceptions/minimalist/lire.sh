#!/bin/sh
# Lecture polie du minimalist (D-483) : robots.txt puis la page, sous CatwalksBot. Rejouable.
set -e
cd "$(dirname "$0")"
python3 ../_lecture-polie/lire-page.py https://beminimalist.co/pages/about --motif='career|joining|reach out' --liens='job|career|recruit'
sleep 2
python3 ../_lecture-polie/lire-page.py https://beminimalist.zohorecruit.in/jobs/Careers --zoho
