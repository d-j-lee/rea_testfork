// Geographic source data in (longitude, latitude) degrees. Shapes are
// simplified by hand from public coastline knowledge; generation perturbs them
// with seeded noise. Coordinates are approximate and meant for a stylized map.

export type LonLat = readonly [number, number];

export const MAP_BOUNDS = {
  west: 124.0,
  east: 131.0,
  north: 43.2,
  south: 33.0,
} as const;

/** Mainland outline, clockwise from the north-west corner of the map. */
export const MAINLAND: readonly LonLat[] = [
  [124.0, 43.2],
  [131.0, 43.2],
  [131.0, 42.75],
  [130.72, 42.45],
  [130.66, 42.3],
  [130.35, 42.22],
  [130.05, 42.0],
  [129.82, 41.8],
  [129.72, 41.45],
  [129.68, 41.12],
  [129.32, 40.82],
  [129.08, 40.58],
  [128.65, 40.3],
  [128.3, 40.05],
  [127.95, 39.95],
  [127.62, 39.8],
  [127.5, 39.55],
  [127.55, 39.32],
  [127.4, 39.18],
  [127.62, 39.05],
  [127.98, 38.86],
  [128.25, 38.6],
  [128.45, 38.38],
  [128.6, 38.12],
  [128.78, 37.9],
  [128.95, 37.7],
  [129.1, 37.48],
  [129.3, 37.2],
  [129.38, 36.95],
  [129.42, 36.6],
  [129.45, 36.3],
  [129.58, 36.06],
  [129.48, 35.8],
  [129.43, 35.5],
  [129.3, 35.32],
  [129.12, 35.12],
  [128.98, 35.05],
  [128.78, 35.08],
  [128.6, 35.02],
  [128.5, 34.88],
  [128.35, 34.86],
  [128.1, 34.92],
  [127.92, 34.98],
  [127.75, 34.74],
  [127.55, 34.76],
  [127.35, 34.52],
  [127.12, 34.55],
  [126.9, 34.42],
  [126.58, 34.3],
  [126.42, 34.42],
  [126.33, 34.6],
  [126.36, 34.8],
  [126.28, 35.05],
  [126.38, 35.32],
  [126.48, 35.6],
  [126.62, 35.88],
  [126.7, 36.0],
  [126.52, 36.2],
  [126.5, 36.45],
  [126.32, 36.62],
  [126.12, 36.72],
  [126.28, 36.95],
  [126.62, 36.98],
  [126.82, 36.95],
  [126.78, 37.12],
  [126.62, 37.28],
  [126.6, 37.48],
  [126.66, 37.62],
  [126.55, 37.82],
  [126.25, 37.8],
  [125.92, 37.72],
  [125.6, 37.72],
  [125.3, 37.82],
  [124.95, 37.98],
  [124.7, 38.12],
  [124.95, 38.42],
  [125.1, 38.62],
  [125.18, 38.88],
  [125.42, 39.18],
  [125.32, 39.42],
  [125.05, 39.55],
  [124.7, 39.62],
  [124.42, 39.85],
  [124.2, 39.88],
  [124.0, 39.82],
];

/** Island outlines as ellipses: centre, longitude radius, latitude radius. */
export const ISLANDS: readonly {
  readonly id: string;
  readonly name: string;
  readonly centre: LonLat;
  readonly rx: number;
  readonly ry: number;
}[] = [
  { id: "ganghwa", name: "강화도", centre: [126.44, 37.7], rx: 0.13, ry: 0.11 },
  { id: "jeju", name: "제주도", centre: [126.55, 33.38], rx: 0.38, ry: 0.17 },
  { id: "geoje", name: "거제도", centre: [128.62, 34.86], rx: 0.11, ry: 0.11 },
  { id: "hansan", name: "한산도", centre: [128.48, 34.75], rx: 0.05, ry: 0.04 },
  { id: "namhae", name: "남해도", centre: [127.95, 34.8], rx: 0.1, ry: 0.08 },
  { id: "jindo", name: "진도", centre: [126.24, 34.44], rx: 0.1, ry: 0.08 },
  { id: "wando", name: "완도", centre: [126.72, 34.3], rx: 0.07, ry: 0.05 },
  {
    id: "geogeum",
    name: "거금도",
    centre: [127.15, 34.42],
    rx: 0.06,
    ry: 0.04,
  },
  {
    id: "tsushima_n",
    name: "대마도",
    centre: [129.32, 34.55],
    rx: 0.1,
    ry: 0.18,
  },
  {
    id: "tsushima_s",
    name: "대마도",
    centre: [129.27, 34.25],
    rx: 0.09,
    ry: 0.13,
  },
  { id: "ulleung", name: "울릉도", centre: [130.87, 37.5], rx: 0.06, ry: 0.05 },
  { id: "wihwa", name: "위화도", centre: [124.45, 40.07], rx: 0.05, ry: 0.025 },
  { id: "geomun", name: "거문도", centre: [127.31, 34.03], rx: 0.04, ry: 0.03 },
  {
    id: "heuksan",
    name: "흑산도",
    centre: [125.43, 34.68],
    rx: 0.04,
    ry: 0.03,
  },
  {
    id: "baengnyeong",
    name: "백령도",
    centre: [124.68, 37.96],
    rx: 0.04,
    ry: 0.03,
  },
];

export interface RiverSource {
  readonly id: string;
  readonly name: string;
  /** Source to mouth. */
  readonly path: readonly LonLat[];
  /** Width in tiles near the mouth; tapers toward the source. */
  readonly width: number;
}

export const RIVERS: readonly RiverSource[] = [
  {
    id: "amnok",
    name: "압록강",
    width: 2.2,
    path: [
      [128.06, 41.99],
      [127.62, 41.72],
      [127.0, 41.42],
      [126.55, 41.1],
      [126.1, 40.88],
      [125.62, 40.62],
      [125.2, 40.4],
      [124.8, 40.22],
      [124.5, 40.1],
      [124.38, 39.92],
    ],
  },
  {
    id: "duman",
    name: "두만강",
    width: 1.6,
    path: [
      [128.12, 42.0],
      [128.75, 42.12],
      [129.3, 42.42],
      [129.72, 42.92],
      [130.08, 42.78],
      [130.32, 42.55],
      [130.68, 42.32],
    ],
  },
  {
    id: "cheongcheon",
    name: "청천강",
    width: 1.3,
    path: [
      [126.62, 40.22],
      [126.1, 39.9],
      [125.72, 39.68],
      [125.42, 39.56],
    ],
  },
  {
    id: "daedong",
    name: "대동강",
    width: 1.6,
    path: [
      [126.88, 39.98],
      [126.42, 39.5],
      [126.0, 39.2],
      [125.75, 39.0],
      [125.45, 38.8],
      [125.16, 38.72],
    ],
  },
  {
    id: "imjin",
    name: "임진강",
    width: 1.1,
    path: [
      [127.5, 38.62],
      [127.12, 38.2],
      [126.88, 37.92],
      [126.68, 37.76],
    ],
  },
  {
    id: "han",
    name: "한강",
    width: 1.8,
    path: [
      [128.72, 37.32],
      [128.3, 37.2],
      [127.92, 37.24],
      [127.58, 37.38],
      [127.32, 37.52],
      [127.08, 37.53],
      [126.92, 37.52],
      [126.76, 37.6],
      [126.62, 37.72],
    ],
  },
  {
    id: "bukhan",
    name: "북한강",
    width: 1.1,
    path: [
      [127.78, 38.25],
      [127.7, 37.88],
      [127.5, 37.65],
      [127.32, 37.53],
    ],
  },
  {
    id: "geum",
    name: "금강",
    width: 1.4,
    path: [
      [127.48, 35.82],
      [127.62, 36.2],
      [127.4, 36.48],
      [127.12, 36.47],
      [126.92, 36.28],
      [126.82, 36.1],
      [126.7, 36.0],
    ],
  },
  {
    id: "yeongsan",
    name: "영산강",
    width: 1.1,
    path: [
      [126.98, 35.3],
      [126.82, 35.08],
      [126.62, 34.9],
      [126.4, 34.8],
    ],
  },
  {
    id: "seomjin",
    name: "섬진강",
    width: 1.0,
    path: [
      [127.22, 35.62],
      [127.38, 35.3],
      [127.62, 35.1],
      [127.76, 34.97],
    ],
  },
  {
    id: "nakdong",
    name: "낙동강",
    width: 1.8,
    path: [
      [129.0, 37.12],
      [128.9, 36.8],
      [128.72, 36.55],
      [128.42, 36.3],
      [128.38, 36.0],
      [128.45, 35.68],
      [128.58, 35.45],
      [128.78, 35.32],
      [128.95, 35.1],
    ],
  },
];

/** Main mountain ridges; tiles near a ridge rise into hills and peaks. */
export const RIDGES: readonly {
  readonly id: string;
  readonly name: string;
  readonly path: readonly LonLat[];
  readonly radius: number;
}[] = [
  {
    id: "baekdudaegan",
    name: "백두대간",
    radius: 0.32,
    path: [
      [128.06, 41.99],
      [127.75, 41.3],
      [127.3, 40.55],
      [127.15, 40.05],
      [127.55, 39.45],
      [127.95, 38.95],
      [128.12, 38.62],
      [128.4, 38.12],
      [128.62, 37.72],
      [128.92, 37.2],
      [128.55, 36.95],
      [128.15, 36.8],
      [127.85, 36.55],
      [127.75, 36.0],
      [127.58, 35.5],
      [127.72, 35.33],
    ],
  },
  {
    id: "hamgyeong",
    name: "함경산맥",
    radius: 0.25,
    path: [
      [127.3, 40.55],
      [128.0, 40.95],
      [128.75, 41.4],
      [129.35, 41.95],
    ],
  },
  {
    id: "gaema",
    name: "개마고원",
    radius: 0.42,
    path: [
      [127.4, 41.2],
      [128.0, 41.25],
      [128.6, 41.0],
    ],
  },
  {
    id: "myohyang",
    name: "묘향산맥",
    radius: 0.18,
    path: [
      [127.0, 40.2],
      [126.4, 39.9],
      [125.9, 39.75],
    ],
  },
  {
    id: "hallasan",
    name: "한라산",
    radius: 0.09,
    path: [
      [126.5, 33.38],
      [126.56, 33.36],
    ],
  },
];

/** Mountain passes carved open so roads can cross ridges. */
export const PASSES: readonly {
  readonly id: string;
  readonly name: string;
  readonly at: LonLat;
}[] = [
  { id: "joryeong", name: "조령(문경새재)", at: [128.08, 36.8] },
  { id: "jungnyeong", name: "죽령", at: [128.42, 36.88] },
  { id: "chupungnyeong", name: "추풍령", at: [127.98, 36.22] },
  { id: "palryangchi", name: "팔량치", at: [127.6, 35.42] },
  { id: "daegwallyeong", name: "대관령", at: [128.75, 37.68] },
  { id: "cheollyeong", name: "철령", at: [127.55, 38.85] },
  { id: "hwangchoryeong", name: "황초령", at: [127.35, 40.2] },
  { id: "manggang", name: "마천령", at: [128.95, 41.45] },
];

export type Province =
  | "gyeonggi"
  | "chungcheong"
  | "jeolla"
  | "gyeongsang"
  | "gangwon"
  | "hwanghae"
  | "pyeongan"
  | "hamgyeong"
  | "jeju"
  | "liaodong"
  | "tsushima";

export const PROVINCE_NAMES: Readonly<Record<Province, string>> = {
  gyeonggi: "경기",
  chungcheong: "충청",
  jeolla: "전라",
  gyeongsang: "경상",
  gangwon: "강원",
  hwanghae: "황해",
  pyeongan: "평안",
  hamgyeong: "함경",
  jeju: "제주",
  liaodong: "요동·만주",
  tsushima: "대마도",
};

/** Voronoi anchors for provinces (approximate centroids). */
export const PROVINCE_ANCHORS: readonly {
  readonly province: Province;
  readonly at: LonLat;
}[] = [
  { province: "gyeonggi", at: [127.1, 37.45] },
  { province: "chungcheong", at: [127.0, 36.45] },
  { province: "chungcheong", at: [127.85, 36.85] },
  { province: "jeolla", at: [126.95, 35.35] },
  { province: "jeolla", at: [127.3, 35.85] },
  { province: "gyeongsang", at: [128.6, 35.6] },
  { province: "gyeongsang", at: [128.7, 36.5] },
  { province: "gangwon", at: [128.35, 37.65] },
  { province: "gangwon", at: [127.75, 38.3] },
  { province: "hwanghae", at: [125.7, 38.35] },
  { province: "pyeongan", at: [125.9, 39.5] },
  { province: "pyeongan", at: [126.4, 40.4] },
  { province: "hamgyeong", at: [127.9, 40.2] },
  { province: "hamgyeong", at: [129.2, 41.6] },
  { province: "jeju", at: [126.55, 33.4] },
  { province: "tsushima", at: [129.3, 34.4] },
  { province: "liaodong", at: [124.5, 41.9] },
  { province: "liaodong", at: [126.5, 42.7] },
  { province: "liaodong", at: [129.5, 43.1] },
];

export type SiteKind =
  | "capital"
  | "city"
  | "town"
  | "fortress"
  | "port"
  | "battlefield"
  | "village"
  | "frontier";

export interface SiteSource {
  readonly id: string;
  readonly name: string;
  readonly hanja?: string;
  readonly kind: SiteKind;
  readonly at: LonLat;
  /** Post-station on the road network (fast travel with 마패). */
  readonly station: boolean;
}

export const SITES: readonly SiteSource[] = [
  {
    id: "hanyang",
    name: "한양",
    hanja: "漢陽",
    kind: "capital",
    at: [126.98, 37.6],
    station: true,
  },
  {
    id: "gaegyeong",
    name: "개경",
    hanja: "開京",
    kind: "capital",
    at: [126.56, 37.98],
    station: true,
  },
  {
    id: "pyeongyang",
    name: "평양",
    hanja: "平壤",
    kind: "city",
    at: [125.76, 39.06],
    station: true,
  },
  {
    id: "uiju",
    name: "의주",
    hanja: "義州",
    kind: "frontier",
    at: [124.6, 40.2],
    station: true,
  },
  {
    id: "wihwado",
    name: "위화도",
    hanja: "威化島",
    kind: "battlefield",
    at: [124.45, 40.07],
    station: false,
  },
  {
    id: "hamheung",
    name: "함흥",
    hanja: "咸興",
    kind: "city",
    at: [127.53, 39.92],
    station: true,
  },
  {
    id: "hoeryeong",
    name: "회령",
    hanja: "會寧",
    kind: "frontier",
    at: [129.72, 42.38],
    station: true,
  },
  {
    id: "gyeongseong",
    name: "경성",
    hanja: "鏡城",
    kind: "town",
    at: [129.6, 41.6],
    station: false,
  },
  {
    id: "haeju",
    name: "해주",
    hanja: "海州",
    kind: "town",
    at: [125.72, 38.06],
    station: false,
  },
  {
    id: "ganghwa",
    name: "강화",
    hanja: "江華",
    kind: "fortress",
    at: [126.45, 37.72],
    station: true,
  },
  {
    id: "jemulpo",
    name: "제물포",
    hanja: "濟物浦",
    kind: "port",
    at: [126.66, 37.46],
    station: false,
  },
  {
    id: "namhansanseong",
    name: "남한산성",
    hanja: "南漢山城",
    kind: "fortress",
    at: [127.19, 37.45],
    station: true,
  },
  {
    id: "haengju",
    name: "행주산성",
    hanja: "幸州山城",
    kind: "fortress",
    at: [126.82, 37.62],
    station: false,
  },
  {
    id: "suwon",
    name: "수원",
    hanja: "水原",
    kind: "city",
    at: [127.02, 37.27],
    station: true,
  },
  {
    id: "wonju",
    name: "원주",
    hanja: "原州",
    kind: "town",
    at: [127.95, 37.36],
    station: false,
  },
  {
    id: "gangneung",
    name: "강릉",
    hanja: "江陵",
    kind: "town",
    at: [128.88, 37.76],
    station: true,
  },
  {
    id: "chungju",
    name: "충주",
    hanja: "忠州",
    kind: "city",
    at: [127.92, 36.98],
    station: true,
  },
  {
    id: "mungyeong",
    name: "조령",
    hanja: "鳥嶺",
    kind: "fortress",
    at: [128.08, 36.78],
    station: false,
  },
  {
    id: "sangju",
    name: "상주",
    hanja: "尙州",
    kind: "town",
    at: [128.16, 36.42],
    station: false,
  },
  {
    id: "andong",
    name: "안동",
    hanja: "安東",
    kind: "town",
    at: [128.73, 36.57],
    station: false,
  },
  {
    id: "gongju",
    name: "공주",
    hanja: "公州",
    kind: "city",
    at: [127.12, 36.43],
    station: true,
  },
  {
    id: "jinpo",
    name: "진포",
    hanja: "鎭浦",
    kind: "port",
    at: [126.74, 36.02],
    station: false,
  },
  {
    id: "jeonju",
    name: "전주",
    hanja: "全州",
    kind: "city",
    at: [127.15, 35.82],
    station: true,
  },
  {
    id: "gobu",
    name: "고부",
    hanja: "古阜",
    kind: "village",
    at: [126.85, 35.58],
    station: false,
  },
  {
    id: "hwangsan",
    name: "황산(운봉)",
    hanja: "荒山",
    kind: "battlefield",
    at: [127.52, 35.45],
    station: false,
  },
  {
    id: "gwangju",
    name: "광주",
    hanja: "光州",
    kind: "town",
    at: [126.88, 35.16],
    station: false,
  },
  {
    id: "myeongnyang",
    name: "명량(울돌목)",
    hanja: "鳴梁",
    kind: "battlefield",
    at: [126.33, 34.57],
    station: false,
  },
  {
    id: "jinju",
    name: "진주",
    hanja: "晉州",
    kind: "fortress",
    at: [128.08, 35.19],
    station: true,
  },
  {
    id: "noryang",
    name: "노량",
    hanja: "露梁",
    kind: "battlefield",
    at: [127.86, 34.95],
    station: false,
  },
  {
    id: "tongyeong",
    name: "통영(한산)",
    hanja: "統營",
    kind: "port",
    at: [128.42, 34.87],
    station: true,
  },
  {
    id: "daegu",
    name: "대구",
    hanja: "大邱",
    kind: "city",
    at: [128.6, 35.87],
    station: true,
  },
  {
    id: "gyeongju",
    name: "경주",
    hanja: "慶州",
    kind: "town",
    at: [129.2, 35.84],
    station: false,
  },
  {
    id: "dongnae",
    name: "동래·부산",
    hanja: "東萊",
    kind: "port",
    at: [129.06, 35.17],
    station: true,
  },
  {
    id: "jeju",
    name: "제주",
    hanja: "濟州",
    kind: "town",
    at: [126.53, 33.48],
    station: false,
  },
  {
    id: "tsushima",
    name: "대마도",
    hanja: "對馬島",
    kind: "port",
    at: [129.3, 34.4],
    station: false,
  },
  {
    id: "ulleung",
    name: "울릉도",
    hanja: "鬱陵島",
    kind: "village",
    at: [130.87, 37.5],
    station: false,
  },
];
