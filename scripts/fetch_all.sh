#!/bin/sh
# 元データの取得（scripts/.cache に保存。リポジトリには入れない）
set -e
cd "$(dirname "$0")"
C=.cache/plateau
CITYGML=https://assets.cms.plateau.reearth.io/assets/04/96d45a-a30b-4c9f-88c0-c1323b5a0f86/14100_yokohama-shi_city_2024_citygml_2_op.zip
RELATED=https://assets.cms.plateau.reearth.io/assets/56/04f4b5-3e91-4c83-b456-36a549ffc865/14100_yokohama-shi_2023_related.zip
python3 fetch_plateau.py $CITYGML $C \
  udx/bldg/53391531_bldg_6697_op.gml \
  udx/bldg/53391531_bldg_6697_appearance/yok1127.jpg \
  udx/bldg/53391521_bldg_6697_op.gml \
  udx/bldg/53391520_bldg_6697_op.gml \
  udx/bldg/53391530_bldg_6697_op.gml \
  udx/veg/53391531_veg_6697_op.gml \
  udx/veg/53391530_veg_6697_op.gml
python3 fetch_plateau.py $RELATED $C \
  14100_yokohama-shi_city_2023_park.geojson \
  14104_yokohama-shi_city_2023_naka-ku_landmark.geojson \
  14104_yokohama-shi_city_2023_naka-ku_station.geojson
