extensions [gis fetch]

globals [dc-dataset neighbor-pairs loaded? data-url
]

;;What do the patches own?
patches-own [ID     ;;patch ID is identical with polygon ID_ID
  popu          ;;population
  mycolor      ;;its color
  myneighbors  ;;neighboring polygons' centroid patches
]

turtles-own[tcolor
  percentage-same   ;;percentage of same color turtles on neighbors
  happy?   ;;happy if neighboring same color agents >= 50%
  tneighbors   ;;an agentset of its neighbor turtles
  rneighbors   ;;number of red neighbors
  bneighbors   ;;number of blue neighbors
  tneighborpolygons  ;;neighboring polygons' centroid patches
]


to setup
  ca
  reset-ticks
  set loaded? false
  set data-url "https://raw.githubusercontent.com/Base27-CVNSS/NetLogo/main/abmgis/data/dc.geojson"
  ;; NetLogo Web không có file system: tải GeoJSON qua Fetch rồi nạp từ chuỗi.
  fetch:url-async data-url [ geojson-text -> finish-setup geojson-text ]
end

to finish-setup [geojson-text]
  set dc-dataset gis:load-dataset-from-string "geojson" geojson-text
  gis:set-world-envelope gis:envelope-of dc-dataset


  ;;drawing the map
  ;; In these lines we go through each vector-feature (each polygon),
  ;;change the drawing color according to the SOC attribute, and then fill the polygon
  ;;with the corresponding color.

  foreach gis:feature-list-of dc-dataset
  [ [?1] -> if gis:property-value ?1 "SOC" = "RED" [ gis:set-drawing-color red  gis:fill ?1 2.0]
    if gis:property-value ?1 "SOC" = "BLUE" [ gis:set-drawing-color blue  gis:fill ?1 2.0]
    if gis:property-value ?1 "SOC" = "UNOCCUPIED" [ gis:set-drawing-color grey  gis:fill ?1 2.0]
  ]
  ;;In the next  two lines, we use gis:draw to draw the boundary of polygon data using white color
  gis:set-drawing-color white
  gis:draw dc-dataset 1

  ;;each polygon identifies a patch at centroid, which records the color and population here
  ;; We do this beacasue in  Netlogo, we can not ask a polygon to perform anything.
  ;;Therefore, in order to study the area, we need to copy the attributes into patches.
  ;;To do that, we loop through each polygon and copy the color attribute to the patch at its
  ;;centroid. In this way, we are using one patch to represent one polygon.

  let n 1
  foreach gis:feature-list-of dc-dataset
  [ [?1] -> let center-point gis:location-of gis:centroid-of ?1
    ask patch item 0 center-point item 1 center-point [
      set ID n
      ;set popu gis:property-value ? "POPU"
      set mycolor gis:property-value ?1 "SOC"
      if mycolor != "UNOCCUPIED" [sprout 1 [ ht set tcolor [mycolor] of myself setcolor]

    ]]
    set n n + 1 ]

  ask patches with [ID > 0] [ set myneighbors n-of 0 patches ;;empty agentset
  ]

  ;; Web: topology embedded because NetLogo Web has no file primitives.
  set neighbor-pairs [
    [1 3] [1 5] [1 6] [1 62] [1 81] [1 82] [1 91] [2 3] [2 4] [2 12] [3 1] [3 2] [3 4] [3 5] [3 12] [4 2] [4 3] [4 5] [4 10] [4 11] [4 12] [5 1] [5 3] [5 4] [5 6] [5 7] [5 8] [5 9] [5 10] [6 1] [6 5] [6 7] [6 20] [6 43] [6 45] [6 59] [6 60] [6 62] [7 5] [7 6] [7 8] [7 20] [8 5] [8 7] [8 9] [8 16] [8 18] [8 20] [9 5] [9 8] [9 10] [9 11] [9 16] [10 4] [10 5] [10 9] [10 11] [11 4] [11 9] [11 10] [11 12] [11 13] [11 14] [11 16] [12 2] [12 3] [12 4] [12 11] [13 11] [13 14] [13 15] [13 16] [14 11] [14 13] [15 13] [15 16] [15 17] [15 18] [16 8] [16 9] [16 11] [16 13] [16 15] [16 18] [17 15] [17 18] [17 19] [17 21] [17 22] [18 8] [18 15] [18 16] [18 17] [18 19] [18 20] [18 22] [19 17] [19 18] [19 20] [19 22] [19 23] [19 28] [19 32] [19 43] [20 6] [20 7] [20 8] [20 18] [20 19] [20 43] [20 45] [21 17] [21 22] [21 23] [22 17] [22 18] [22 19] [22 21] [22 23] [23 19] [23 21] [23 22] [23 24] [23 28] [23 32] [24 23] [24 25] [24 27] [24 28] [25 24] [25 26] [25 27] [25 29] [25 30] [26 25] [26 30] [26 31] [26 165] [27 24] [27 25] [27 28] [27 29] [28 19] [28 23] [28 24] [28 27] [28 29] [28 32] [29 25] [29 27] [29 28] [29 30] [29 32] [29 33] [30 25] [30 26] [30 29] [30 31] [30 33] [30 34] [30 35] [31 26] [31 30] [31 34] [31 35] [31 165] [32 19] [32 23] [32 28] [32 29] [32 33] [32 43] [33 29] [33 30] [33 32] [33 34] [33 36] [33 40] [33 41] [33 43] [34 30] [34 31] [34 33] [34 35] [34 36] [34 37] [35 30] [35 31] [35 34] [35 36] [35 37] [35 162] [35 165] [35 167] [36 33] [36 34] [36 35] [36 37] [36 38] [36 40] [36 41] [37 34] [37 35] [37 36] [37 38] [37 39] [37 40] [37 162] [37 167] [38 36] [38 37] [38 39] [38 40] [38 51] [39 37] [39 38] [39 40] [39 51] [39 52] [39 54] [39 156] [39 157] [39 162] [40 33] [40 36] [40 37] [40 38] [40 39] [40 41] [40 42] [40 50] [40 51] [41 33] [41 36] [41 40] [41 42] [41 43] [42 40] [42 41] [42 43] [42 44] [42 46] [42 48] [42 50] [42 51] [43 6] [43 19] [43 20] [43 32] [43 33] [43 41] [43 42] [43 44] [43 45] [44 42] [44 43] [44 45] [44 46] [44 47] [45 6] [45 20] [45 43] [45 44] [45 47] [45 59] [46 42] [46 44] [46 47] [46 48] [47 44] [47 45] [47 46] [47 48] [47 49] [47 56] [47 57] [47 58] [47 59] [48 42] [48 46] [48 47] [48 49] [48 50] [49 47] [49 48] [49 50] [49 55] [49 56] [50 40] [50 42] [50 48] [50 49] [50 51] [50 54] [50 55] [50 56] [51 38] [51 39] [51 40] [51 42] [51 50] [51 54] [52 39] [52 53] [52 54] [52 145] [52 157] [53 52] [53 54] [53 67] [53 144] [53 145] [53 157] [54 39] [54 50] [54 51] [54 52] [54 53] [54 55] [54 66] [54 67] [54 69] [55 49] [55 50] [55 54] [55 56] [55 66] [55 69] [56 47] [56 49] [56 50] [56 55] [56 57] [56 65] [56 66] [57 47] [57 56] [57 58] [57 63] [57 65] [57 66] [58 47] [58 57] [58 59] [58 60] [58 61] [58 63] [58 64] [58 65] [59 6] [59 45] [59 47] [59 58] [59 60] [59 61] [60 6] [60 58] [60 59] [60 61] [60 62] [61 58] [61 59] [61 60] [61 62] [61 63] [61 64] [61 81] [62 1] [62 6] [62 60] [62 61] [62 64] [62 81] [63 57] [63 58] [63 61] [63 64] [63 65] [63 75] [63 77] [64 58] [64 61] [64 62] [64 63] [64 77] [64 81] [65 56] [65 57] [65 58] [65 63] [65 66] [65 73] [65 75] [65 77] [66 54] [66 55] [66 56] [66 57] [66 65] [66 69] [66 71] [66 73] [66 75] [67 53] [67 54] [67 68] [67 69] [67 70] [67 144] [67 145] [68 67] [68 70] [68 72] [68 85] [68 86] [68 91] [68 144] [69 54] [69 55] [69 66] [69 67] [69 70] [69 71] [69 72] [70 67] [70 68] [70 69] [70 71] [70 72] [70 85] [71 66] [71 69] [71 70] [71 72] [71 73] [72 68] [72 69] [72 70] [72 71] [72 73] [72 74] [72 85] [73 65] [73 66] [73 71] [73 72] [73 74] [73 75] [74 72] [74 73] [74 75] [74 76] [74 85] [74 91] [75 63] [75 65] [75 66] [75 73] [75 74] [75 76] [75 77] [76 74] [76 75] [76 77] [76 78] [76 91] [77 63] [77 64] [77 65] [77 75] [77 76] [77 78] [77 81] [78 76] [78 77] [78 80] [78 81] [78 91] [79 80] [79 81] [79 83] [79 84] [80 78] [80 79] [80 81] [80 83] [80 84] [80 91] [81 1] [81 61] [81 62] [81 64] [81 77] [81 78] [81 79] [81 80] [81 82] [81 83] [82 1] [82 81] [82 83] [82 91] [83 79] [83 80] [83 81] [83 82] [83 84] [83 91] [84 79] [84 80] [84 83] [84 91] [85 68] [85 70] [85 72] [85 74] [85 86] [85 91] [86 68] [86 85] [86 91] [86 144] [87 88] [87 89] [87 91] [87 95] [87 104] [88 87] [88 89] [88 92] [88 94] [88 104] [89 87] [89 88] [89 90] [89 91] [89 92] [90 89] [90 91] [90 92] [91 1] [91 68] [91 74] [91 76] [91 78] [91 80] [91 82] [91 83] [91 84] [91 85] [91 86] [91 87] [91 89] [91 90] [91 92] [91 93] [91 95] [91 96] [91 105] [91 138] [91 139] [91 144] [92 88] [92 89] [92 90] [92 91] [92 93] [92 94] [93 91] [93 92] [93 94] [93 105] [94 88] [94 92] [94 93] [94 104] [94 105] [94 109] [95 87] [95 91] [95 96] [95 102] [95 104] [96 91] [96 95] [96 97] [96 102] [96 137] [96 138] [97 96] [97 98] [97 99] [97 101] [97 102] [97 136] [97 137] [97 138] [98 97] [98 99] [98 100] [98 101] [98 136] [99 97] [99 98] [99 100] [99 101] [99 103] [100 98] [100 99] [100 103] [100 119] [100 125] [100 126] [100 134] [100 136] [100 152] [100 170] [100 172] [101 97] [101 98] [101 99] [101 102] [101 103] [102 95] [102 96] [102 97] [102 101] [102 103] [102 104] [103 99] [103 100] [103 101] [103 102] [103 104] [103 109] [103 119] [103 126] [104 87] [104 88] [104 94] [104 95] [104 102] [104 103] [104 105] [104 109] [104 119] [105 91] [105 93] [105 94] [105 104] [105 106] [105 108] [105 109] [105 179] [105 181] [106 105] [106 107] [106 176] [106 177] [106 179] [106 181] [107 106] [107 110] [107 111] [107 115] [107 173] [107 174] [107 177] [107 181] [108 105] [108 179] [108 180] [109 94] [109 103] [109 104] [109 105] [109 111] [109 112] [109 113] [109 117] [109 119] [109 181] [110 107] [110 111] [110 114] [110 115] [111 107] [111 109] [111 110] [111 112] [111 113] [111 114] [111 181] [112 109] [112 111] [112 113] [113 109] [113 111] [113 112] [113 114] [113 117] [113 118] [114 110] [114 111] [114 113] [114 116] [114 118] [115 107] [115 110] [116 114] [116 118] [116 120] [116 121] [116 122] [117 109] [117 113] [117 118] [117 119] [117 122] [118 113] [118 114] [118 116] [118 117] [118 122] [119 100] [119 103] [119 104] [119 109] [119 117] [119 121] [119 122] [119 126] [120 116] [120 121] [120 183] [121 116] [121 119] [121 120] [121 122] [121 126] [121 182] [121 183] [122 116] [122 117] [122 118] [122 119] [122 121] [123 125] [123 171] [123 182] [123 183] [123 187] [123 188] [124 183] [124 185] [124 186] [124 188] [125 100] [125 123] [125 126] [125 171] [125 172] [125 182] [126 100] [126 103] [126 119] [126 121] [126 125] [126 182] [127 128] [127 129] [127 132] [127 169] [127 170] [127 171] [127 172] [127 187] [128 127] [128 130] [128 131] [128 132] [128 184] [128 185] [128 187] [129 127] [129 130] [129 132] [129 169] [130 128] [130 129] [130 131] [130 132] [131 128] [131 130] [131 184] [132 127] [132 128] [132 129] [132 130] [133 134] [133 135] [133 136] [133 141] [133 147] [133 150] [133 151] [134 100] [134 133] [134 136] [134 151] [134 152] [135 133] [135 136] [135 137] [135 141] [136 97] [136 98] [136 100] [136 133] [136 134] [136 135] [136 137] [137 96] [137 97] [137 135] [137 136] [137 138] [137 140] [137 141] [138 91] [138 96] [138 97] [138 137] [138 139] [138 140] [139 91] [139 138] [139 140] [139 143] [139 144] [140 137] [140 138] [140 139] [140 141] [140 142] [140 143] [141 133] [141 135] [141 137] [141 140] [141 142] [141 143] [141 147] [141 150] [141 151] [142 140] [142 141] [142 143] [142 147] [142 148] [143 139] [143 140] [143 141] [143 142] [143 144] [143 146] [143 147] [143 148] [144 53] [144 67] [144 68] [144 86] [144 91] [144 139] [144 143] [144 145] [144 146] [144 148] [145 52] [145 53] [145 67] [145 144] [145 146] [145 157] [146 143] [146 144] [146 145] [146 148] [146 155] [146 157] [146 158] [146 160] [147 133] [147 141] [147 142] [147 143] [147 148] [147 149] [147 150] [147 151] [148 142] [148 143] [148 144] [148 146] [148 147] [148 149] [148 154] [148 155] [149 147] [149 148] [149 150] [149 152] [149 154] [149 155] [150 133] [150 141] [150 147] [150 149] [150 151] [150 152] [151 133] [151 134] [151 141] [151 147] [151 150] [151 152] [152 100] [152 134] [152 149] [152 150] [152 151] [152 153] [152 154] [152 169] [152 170] [152 172] [153 152] [153 154] [153 169] [154 148] [154 149] [154 152] [154 153] [154 155] [154 159] [154 161] [155 146] [155 148] [155 149] [155 154] [155 158] [155 159] [155 160] [155 161] [156 39] [156 157] [156 158] [156 159] [156 160] [156 162] [156 164] [157 39] [157 52] [157 53] [157 145] [157 146] [157 156] [157 158] [158 146] [158 155] [158 156] [158 157] [158 160] [159 154] [159 155] [159 156] [159 160] [159 161] [159 162] [159 163] [159 164] [160 146] [160 155] [160 156] [160 158] [160 159] [161 154] [161 155] [161 159] [161 163] [162 35] [162 37] [162 39] [162 156] [162 159] [162 164] [162 167] [162 168] [163 159] [163 161] [163 164] [163 167] [163 168] [164 156] [164 159] [164 162] [164 163] [164 168] [165 26] [165 31] [165 35] [165 166] [165 167] [166 165] [166 167] [167 35] [167 37] [167 162] [167 163] [167 165] [167 166] [167 168] [168 162] [168 163] [168 164] [168 167] [169 127] [169 129] [169 152] [169 153] [169 170] [170 100] [170 127] [170 152] [170 169] [170 171] [170 172] [171 123] [171 125] [171 127] [171 170] [171 172] [171 187] [172 100] [172 125] [172 127] [172 152] [172 170] [172 171] [173 107] [173 174] [173 175] [173 177] [173 178] [174 107] [174 173] [174 175] [174 176] [174 177] [174 178] [175 173] [175 174] [175 178] [176 106] [176 174] [176 177] [176 178] [176 179] [177 106] [177 107] [177 173] [177 174] [177 176] [178 173] [178 174] [178 175] [178 176] [178 179] [178 180] [179 105] [179 106] [179 108] [179 176] [179 178] [179 180] [180 108] [180 178] [180 179] [181 105] [181 106] [181 107] [181 109] [181 111] [182 121] [182 123] [182 125] [182 126] [182 183] [182 188] [183 120] [183 121] [183 123] [183 124] [183 182] [183 188] [184 128] [184 131] [184 185] [184 186] [185 124] [185 128] [185 184] [185 186] [185 187] [185 188] [186 124] [186 184] [186 185] [187 123] [187 127] [187 128] [187 171] [187 185] [187 188] [188 123] [188 124] [188 182] [188 183] [188 185] [188 187]
  ]
  foreach neighbor-pairs [ pair ->
    let x item 0 pair
    let y item 1 pair
    ask patches with [ID = x] [
      set myneighbors (patch-set myneighbors patches with [ID = y])
    ]
  ]

  ;;use this line to verify if we get the right neighbors
  ;;ask one-of patches with [ID > 0] [print myneighbors   ask myneighbors [sprout 1]]

  set loaded? true
end

to setcolor
  if tcolor = "RED" [set color red]
  if tcolor = "BLUE" [set color blue]
end

to go
  if not loaded? [ stop ]

  move
  ask patches with [ID > 0] [if count turtles-here > 1 [print "ERROR"]]  ;;verification
  update-colors
  tick
  if count turtles with [happy? = true] = count turtles [stop];;stops the model when all agents are happy

end



to move

  ;;count the number of red or blue turtles in neighboring polygons
  ask turtles [set tneighbors turtles-on [myneighbors] of patch-here
    set tneighborpolygons [myneighbors] of patch-here
    set bneighbors count tneighbors with [tcolor = "BLUE"]
    set rneighbors count tneighbors with [tcolor = "RED"]]


  ;;calculate the percentage of same color turtles
  ask turtles [ ifelse rneighbors + bneighbors = 0 [set percentage-same 1][
    if tcolor = "RED" [set percentage-same rneighbors / (rneighbors + bneighbors)]
    if tcolor = "BLUE" [set percentage-same bneighbors / (rneighbors + bneighbors)]]
    ifelse percentage-same < (Percentage-same-to-be-happy / 100) [set happy? false][set happy? true]]


  ;;move to an unoccupied polygon if not happy. change the color here.
  ask turtles [if happy? = false and count tneighborpolygons with [mycolor = "UNOCCUPIED"] > 0
    [ask patch-here [set mycolor "UNOCCUPIED"]
      move-to one-of tneighborpolygons with [mycolor = "UNOCCUPIED"]
      ask patch-here [set mycolor [tcolor] of myself]]
  ]

end

;if agents move patch colors need to be updated

to update-colors   ;;update polygon colors
                   ;ask turtles [setcolor]
  ask patches with [ID > 0][

    if mycolor = "RED" [ gis:set-drawing-color red  gis:fill  item (ID - 1) gis:feature-list-of dc-dataset 2.0]
    if mycolor = "BLUE" [ gis:set-drawing-color blue  gis:fill  item (ID - 1) gis:feature-list-of dc-dataset 2.0]
    if mycolor = "UNOCCUPIED" [ gis:set-drawing-color grey  gis:fill  item (ID - 1) gis:feature-list-of dc-dataset 2.0]
  ]
  gis:set-drawing-color white
  gis:draw dc-dataset 1
end
@#$#@#$#@
GRAPHICS-WINDOW
297
13
820
537
-1
-1
6.36
1
10
1
1
1
0
1
1
1
-40
40
-40
40
0
0
1
ticks
30.0

BUTTON
40
31
103
64
NIL
setup
NIL
1
T
OBSERVER
NIL
NIL
NIL
NIL
1

BUTTON
186
31
249
64
NIL
go
T
1
T
OBSERVER
NIL
NIL
NIL
NIL
1

BUTTON
114
31
177
64
NIL
go
NIL
1
T
OBSERVER
NIL
NIL
NIL
NIL
1

MONITOR
32
158
107
203
NIL
count turtles
17
1
11

MONITOR
114
159
188
204
polygons
count patches with [ID > 0]
17
1
11

MONITOR
193
160
268
205
unoccupied
count patches with [mycolor = \"UNOCCUPIED\"]
17
1
11

MONITOR
31
210
106
255
Red
count turtles with [tcolor = \"RED\"]
17
1
11

MONITOR
114
209
187
254
Blue
count turtles with [tcolor = \"BLUE\"]
17
1
11

SLIDER
34
75
254
108
Percentage-same-to-be-happy
Percentage-same-to-be-happy
1
100
35.0
5
1
NIL
HORIZONTAL

PLOT
31
264
277
429
Number of Happy Agents
Time
Number
0.0
10.0
0.0
150.0
true
false
"" ""
PENS
"default" 1.0 0 -16777216 true "" "plot count turtles with [happy? = true]"

MONITOR
193
209
270
254
No. Happy
count turtles with [happy? = true]
17
1
11

@#$#@#$#@
## WHAT IS IT?
This is a segregation model built using the map of Wahington DC. The form of data is vector data. This model is inspired by the Schelling segregation model.

![Picture not found](file:data/DCmap2.jpg)

## HOW IT WORKS

There is one agent in each polygon. They are either blue or red. They look at the color of their geometrical neighboring polygons and decided whether they are happy or not. There is a slider to adjust how much percentage of same color neighbors they need to be happy. If one is not happy, it will move to an unoccupied neighboring polygon.

## HOW TO USE IT

1. Adjust "Percentage-same-to-be-happy" slider.
2. Press Setup to display the map and locate agents.
3. Press Go to ask agents to move for once.
4. Or Go forever to ask agents to move until all are happy.
5. Export the map to ArcGIS.

## THINGS TO NOTICE

In this simple model, there is only one turtle in each polygon, therefore, the polygon has same color with the turtle on it.

## THINGS TO TRY

Try different levels of percentage-same needed to be happy. Is there a level after which they can't reach static situation?

Export the final map to a text file and open it in ArcGIS to save as .dbf file. Replace the DC.dbf with this file and open DC.shp in ArcGIS.

## EXTENDING THE MODEL

What if there are more than one agent in each polygon? The shapefile has a variable population, it may be used to explore this question.

## NETLOGO FEATURES

It is tricky to find the geometrical neighbors of each polygon, since Netlogo does not have this function. How I did it was to use the Polygon Neighbors function in ArcGIS 10.2 to create a text file which maps each polygon to its neighbors. Then, I deleted unecessary information like headers and ask Netlogo to read the information.


## RELATED MODELS

Segregation model in the library.

## CREDITS AND REFERENCES

Schelling, T. C. (1969). Models of segregation. The American Economic Review, 488-493.
@#$#@#$#@
default
true
0
Polygon -7500403 true true 150 5 40 250 150 205 260 250

airplane
true
0
Polygon -7500403 true true 150 0 135 15 120 60 120 105 15 165 15 195 120 180 135 240 105 270 120 285 150 270 180 285 210 270 165 240 180 180 285 195 285 165 180 105 180 60 165 15

arrow
true
0
Polygon -7500403 true true 150 0 0 150 105 150 105 293 195 293 195 150 300 150

box
false
0
Polygon -7500403 true true 150 285 285 225 285 75 150 135
Polygon -7500403 true true 150 135 15 75 150 15 285 75
Polygon -7500403 true true 15 75 15 225 150 285 150 135
Line -16777216 false 150 285 150 135
Line -16777216 false 150 135 15 75
Line -16777216 false 150 135 285 75

bug
true
0
Circle -7500403 true true 96 182 108
Circle -7500403 true true 110 127 80
Circle -7500403 true true 110 75 80
Line -7500403 true 150 100 80 30
Line -7500403 true 150 100 220 30

butterfly
true
0
Polygon -7500403 true true 150 165 209 199 225 225 225 255 195 270 165 255 150 240
Polygon -7500403 true true 150 165 89 198 75 225 75 255 105 270 135 255 150 240
Polygon -7500403 true true 139 148 100 105 55 90 25 90 10 105 10 135 25 180 40 195 85 194 139 163
Polygon -7500403 true true 162 150 200 105 245 90 275 90 290 105 290 135 275 180 260 195 215 195 162 165
Polygon -16777216 true false 150 255 135 225 120 150 135 120 150 105 165 120 180 150 165 225
Circle -16777216 true false 135 90 30
Line -16777216 false 150 105 195 60
Line -16777216 false 150 105 105 60

car
false
0
Polygon -7500403 true true 300 180 279 164 261 144 240 135 226 132 213 106 203 84 185 63 159 50 135 50 75 60 0 150 0 165 0 225 300 225 300 180
Circle -16777216 true false 180 180 90
Circle -16777216 true false 30 180 90
Polygon -16777216 true false 162 80 132 78 134 135 209 135 194 105 189 96 180 89
Circle -7500403 true true 47 195 58
Circle -7500403 true true 195 195 58

circle
false
0
Circle -7500403 true true 0 0 300

circle 2
false
0
Circle -7500403 true true 0 0 300
Circle -16777216 true false 30 30 240

cow
false
0
Polygon -7500403 true true 200 193 197 249 179 249 177 196 166 187 140 189 93 191 78 179 72 211 49 209 48 181 37 149 25 120 25 89 45 72 103 84 179 75 198 76 252 64 272 81 293 103 285 121 255 121 242 118 224 167
Polygon -7500403 true true 73 210 86 251 62 249 48 208
Polygon -7500403 true true 25 114 16 195 9 204 23 213 25 200 39 123

cylinder
false
0
Circle -7500403 true true 0 0 300

dot
false
0
Circle -7500403 true true 90 90 120

face happy
false
0
Circle -7500403 true true 8 8 285
Circle -16777216 true false 60 75 60
Circle -16777216 true false 180 75 60
Polygon -16777216 true false 150 255 90 239 62 213 47 191 67 179 90 203 109 218 150 225 192 218 210 203 227 181 251 194 236 217 212 240

face neutral
false
0
Circle -7500403 true true 8 7 285
Circle -16777216 true false 60 75 60
Circle -16777216 true false 180 75 60
Rectangle -16777216 true false 60 195 240 225

face sad
false
0
Circle -7500403 true true 8 8 285
Circle -16777216 true false 60 75 60
Circle -16777216 true false 180 75 60
Polygon -16777216 true false 150 168 90 184 62 210 47 232 67 244 90 220 109 205 150 198 192 205 210 220 227 242 251 229 236 206 212 183

fish
false
0
Polygon -1 true false 44 131 21 87 15 86 0 120 15 150 0 180 13 214 20 212 45 166
Polygon -1 true false 135 195 119 235 95 218 76 210 46 204 60 165
Polygon -1 true false 75 45 83 77 71 103 86 114 166 78 135 60
Polygon -7500403 true true 30 136 151 77 226 81 280 119 292 146 292 160 287 170 270 195 195 210 151 212 30 166
Circle -16777216 true false 215 106 30

flag
false
0
Rectangle -7500403 true true 60 15 75 300
Polygon -7500403 true true 90 150 270 90 90 30
Line -7500403 true 75 135 90 135
Line -7500403 true 75 45 90 45

flower
false
0
Polygon -10899396 true false 135 120 165 165 180 210 180 240 150 300 165 300 195 240 195 195 165 135
Circle -7500403 true true 85 132 38
Circle -7500403 true true 130 147 38
Circle -7500403 true true 192 85 38
Circle -7500403 true true 85 40 38
Circle -7500403 true true 177 40 38
Circle -7500403 true true 177 132 38
Circle -7500403 true true 70 85 38
Circle -7500403 true true 130 25 38
Circle -7500403 true true 96 51 108
Circle -16777216 true false 113 68 74
Polygon -10899396 true false 189 233 219 188 249 173 279 188 234 218
Polygon -10899396 true false 180 255 150 210 105 210 75 240 135 240

house
false
0
Rectangle -7500403 true true 45 120 255 285
Rectangle -16777216 true false 120 210 180 285
Polygon -7500403 true true 15 120 150 15 285 120
Line -16777216 false 30 120 270 120

leaf
false
0
Polygon -7500403 true true 150 210 135 195 120 210 60 210 30 195 60 180 60 165 15 135 30 120 15 105 40 104 45 90 60 90 90 105 105 120 120 120 105 60 120 60 135 30 150 15 165 30 180 60 195 60 180 120 195 120 210 105 240 90 255 90 263 104 285 105 270 120 285 135 240 165 240 180 270 195 240 210 180 210 165 195
Polygon -7500403 true true 135 195 135 240 120 255 105 255 105 285 135 285 165 240 165 195

line
true
0
Line -7500403 true 150 0 150 300

line half
true
0
Line -7500403 true 150 0 150 150

pentagon
false
0
Polygon -7500403 true true 150 15 15 120 60 285 240 285 285 120

person
false
0
Circle -7500403 true true 110 5 80
Polygon -7500403 true true 105 90 120 195 90 285 105 300 135 300 150 225 165 300 195 300 210 285 180 195 195 90
Rectangle -7500403 true true 127 79 172 94
Polygon -7500403 true true 195 90 240 150 225 180 165 105
Polygon -7500403 true true 105 90 60 150 75 180 135 105

plant
false
0
Rectangle -7500403 true true 135 90 165 300
Polygon -7500403 true true 135 255 90 210 45 195 75 255 135 285
Polygon -7500403 true true 165 255 210 210 255 195 225 255 165 285
Polygon -7500403 true true 135 180 90 135 45 120 75 180 135 210
Polygon -7500403 true true 165 180 165 210 225 180 255 120 210 135
Polygon -7500403 true true 135 105 90 60 45 45 75 105 135 135
Polygon -7500403 true true 165 105 165 135 225 105 255 45 210 60
Polygon -7500403 true true 135 90 120 45 150 15 180 45 165 90

sheep
false
15
Circle -1 true true 203 65 88
Circle -1 true true 70 65 162
Circle -1 true true 150 105 120
Polygon -7500403 true false 218 120 240 165 255 165 278 120
Circle -7500403 true false 214 72 67
Rectangle -1 true true 164 223 179 298
Polygon -1 true true 45 285 30 285 30 240 15 195 45 210
Circle -1 true true 3 83 150
Rectangle -1 true true 65 221 80 296
Polygon -1 true true 195 285 210 285 210 240 240 210 195 210
Polygon -7500403 true false 276 85 285 105 302 99 294 83
Polygon -7500403 true false 219 85 210 105 193 99 201 83

square
false
0
Rectangle -7500403 true true 30 30 270 270

square 2
false
0
Rectangle -7500403 true true 30 30 270 270
Rectangle -16777216 true false 60 60 240 240

star
false
0
Polygon -7500403 true true 151 1 185 108 298 108 207 175 242 282 151 216 59 282 94 175 3 108 116 108

target
false
0
Circle -7500403 true true 0 0 300
Circle -16777216 true false 30 30 240
Circle -7500403 true true 60 60 180
Circle -16777216 true false 90 90 120
Circle -7500403 true true 120 120 60

tree
false
0
Circle -7500403 true true 118 3 94
Rectangle -6459832 true false 120 195 180 300
Circle -7500403 true true 65 21 108
Circle -7500403 true true 116 41 127
Circle -7500403 true true 45 90 120
Circle -7500403 true true 104 74 152

triangle
false
0
Polygon -7500403 true true 150 30 15 255 285 255

triangle 2
false
0
Polygon -7500403 true true 150 30 15 255 285 255
Polygon -16777216 true false 151 99 225 223 75 224

truck
false
0
Rectangle -7500403 true true 4 45 195 187
Polygon -7500403 true true 296 193 296 150 259 134 244 104 208 104 207 194
Rectangle -1 true false 195 60 195 105
Polygon -16777216 true false 238 112 252 141 219 141 218 112
Circle -16777216 true false 234 174 42
Rectangle -7500403 true true 181 185 214 194
Circle -16777216 true false 144 174 42
Circle -16777216 true false 24 174 42
Circle -7500403 false true 24 174 42
Circle -7500403 false true 144 174 42
Circle -7500403 false true 234 174 42

turtle
true
0
Polygon -10899396 true false 215 204 240 233 246 254 228 266 215 252 193 210
Polygon -10899396 true false 195 90 225 75 245 75 260 89 269 108 261 124 240 105 225 105 210 105
Polygon -10899396 true false 105 90 75 75 55 75 40 89 31 108 39 124 60 105 75 105 90 105
Polygon -10899396 true false 132 85 134 64 107 51 108 17 150 2 192 18 192 52 169 65 172 87
Polygon -10899396 true false 85 204 60 233 54 254 72 266 85 252 107 210
Polygon -7500403 true true 119 75 179 75 209 101 224 135 220 225 175 261 128 261 81 224 74 135 88 99

wheel
false
0
Circle -7500403 true true 3 3 294
Circle -16777216 true false 30 30 240
Line -7500403 true 150 285 150 15
Line -7500403 true 15 150 285 150
Circle -7500403 true true 120 120 60
Line -7500403 true 216 40 79 269
Line -7500403 true 40 84 269 221
Line -7500403 true 40 216 269 79
Line -7500403 true 84 40 221 269

wolf
false
0
Polygon -16777216 true false 253 133 245 131 245 133
Polygon -7500403 true true 2 194 13 197 30 191 38 193 38 205 20 226 20 257 27 265 38 266 40 260 31 253 31 230 60 206 68 198 75 209 66 228 65 243 82 261 84 268 100 267 103 261 77 239 79 231 100 207 98 196 119 201 143 202 160 195 166 210 172 213 173 238 167 251 160 248 154 265 169 264 178 247 186 240 198 260 200 271 217 271 219 262 207 258 195 230 192 198 210 184 227 164 242 144 259 145 284 151 277 141 293 140 299 134 297 127 273 119 270 105
Polygon -7500403 true true -1 195 14 180 36 166 40 153 53 140 82 131 134 133 159 126 188 115 227 108 236 102 238 98 268 86 269 92 281 87 269 103 269 113

x
false
0
Polygon -7500403 true true 270 75 225 30 30 225 75 270
Polygon -7500403 true true 30 75 75 30 270 225 225 270
@#$#@#$#@
NetLogo 6.2.2
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
default
0.0
-0.2 0 0.0 1.0
0.0 1 1.0 0.0
0.2 0 0.0 1.0
link direction
true
0
Line -7500403 true 150 150 90 180
Line -7500403 true 150 150 210 180
@#$#@#$#@
0
@#$#@#$#@