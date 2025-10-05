"""
TRF16-based tournament seeder using tournament_core structures.

This module provides functions that use TRF16 data to create tournaments:
1. Parse TRF16 -> tournament_core structures using TRF16Converter
2. Convert structures -> database using structure_to_db
"""

from heltour.tournament_core.trf16_converter import TRF16Converter
from heltour.tournament.structure_to_db import structure_to_db
from django.db import transaction


# Embedded TRF16 data
TRF16_DATA = """012 ΔΙΑΣΥΛΛΟΓΙΚΟ ΚΥΠΕΛΛΟ ΚΡΗΤΙΚΗΣ ΦΙΛΙΑΣ 2024 
022 Heraklion
032 GRE
042 2024/11/23
052 2024/11/24
062 129 (88)
072 84
082 15
092 Team Swiss System
102 FA Stefanatos Charalampos
112 Michailidi Afroditi
112 Gkizis Konstantinos, Magoulianos Nikolaos
122 15 minutes plus 10 sec per move
142 7
132                                                                                        24/11/23  24/11/23  24/11/23  24/11/24  24/11/24  24/11/24  24/11/24

         1         2         3         4         5         6         7         8         9        10        11        12        13        14        15        16
1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
DDD SSSS sTTT NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN RRRR FFF IIIIIIIIIII BBBB/BB/BB PPPP RRRR  1111 1 1  2222 2 2  3333 3 3  4444 4 4  5555 5 5  6666 6 6  7777 7 7 
001    1 m    Psarianos,Emmanouil               1442 GRE    42143683 2014/00/00  3.5   34  0000 - -     7 w 1    99 b 1    19 w 1    59 b 0    29 w 0    13 b =  
001    2 m    Psarakis,Kyriakos                 0000 GRE    42172284 2017/00/00  3.5   38  0000 - -     8 b 1   100 w 1    20 b 1    60 w 0    30 b 0    14 w =  
001    3 m    Bouchlis,Nikolaos                 1424 GRE    42183219 2014/00/00  3.5   37  0000 - -     9 w 1   101 b 1    21 w 1    61 b 0    31 w 0    15 b =  
001    4 m    Lampousakis,Dimitrios Christos    0000 GRE    42189209 2015/00/00  2.0   76  0000 - -    10 b =   102 w 0    55 b =    62 w 1    32 b 0    16 w 0  
001    5 m    Lampousakis,Michail               0000 GRE    42189217 2015/00/00  2.0   77  0000 - -    11 w 0   103 b 0    56 w 0    63 b 1    33 w 1    17 b 0  
001    6 m    Stylianakis,Iosif                 0000 GRE    42185890 2011/00/00  2.5   68  0000 - -    12 b 0   104 w =    57 b 0    64 w 1    34 b 1    18 w 0  
001    7 m    Naoum,Spyridon                    2250 GRE     4227506 1997/00/00  4.0   30    22 w 1     1 b 0   107 w 1    44 b 1    13 w 1  0000 - -    84 b 0  
001    8 m    Bairamian,Artur                   1826 GRE     4295064 2004/00/00  2.5   66    23 b 0     2 w 0   108 b =    45 w 1    14 b 1  0000 - -    85 w 0  
001    9 m    Hatzidakis,Nikolaos               1736 GRE     4252659 1994/00/00  3.5   41    24 w 1     3 b 0   109 w =    46 b 1    15 w 0  0000 - -  0000 - -  
001   10 m    Tripodakis,Emmanouil              0000 GRE    42197740 1984/00/00  2.0   80    25 b 1     4 w =   110 b =    47 w 0    16 b 0  0000 - -    86 w 0  
001   11 f    Schinaraki,Despina                1447 GRE    25835572 1996/00/00  1.0   85    26 w 0     5 b 1   111 w 0    48 b 0    17 w 0  0000 - -    87 b 0  
001   12 f    Agnanti,Danai                     1792 GRE     4231147 1995/00/00  2.5   70    27 b 0     6 w 1  0000 - -    49 w 0    18 b 0  0000 - -    88 w =  
001   13 m    Lirindzakis,Timotheos             2186 GRE     4200381 1960/00/00  4.0   27    44 b 0    19 w 1    36 b =    84 w 1     7 b 0    92 w 1     1 w =  
001   14 m    Stefanatos,Nikolaos               1900 GRE     4223101 1992/00/00  2.5   67    45 w 0    20 b 0    37 w =    85 b 1     8 w 0    93 b =     2 b =  
001   15 m    Papathanasiou,Panayotis           1986 GRE     4203232 1960/00/00  4.5   19    46 b 1    21 w 0    38 b =  0000 - -     9 b 1    94 w =     3 w =  
001   16 m    Spirou,Gerasimos                  1756 GRE     4239814 1987/00/00  4.5   21    47 w 1    55 b 0    39 w 0    86 b 1    10 w 1    95 b =     4 b 1  
001   17 m    Fragiadakis,Emanouel              1788 GRE     4204026 1975/00/00  4.0   33    48 b 0    56 w 0    40 b 0    87 w 1    11 b 1    96 w 1     5 w 1  
001   18 f    Papadimitriou,Argyro              1559 GRE    42133041 2004/00/00  5.5    4    49 w 1    57 b 0    41 w 1    88 b =    12 w 1    97 b 1     6 b 1  
001   19 m    Bakalis,Efthymios                 1446 GRE    42113318 1981/00/00  4.0   28    51 w 1    13 b 0    59 w 1     1 b 0    29 b =    22 w =   107 b 1  
001   20 m    Remediakis,Ioannis                1520 GRE    42145996 1975/00/00  4.5   16    52 b 1    14 w 1    60 b 1     2 w 0    30 w =    23 b 0   108 w 1  
001   21 m    Serlidakis,Konstantinos           1489 GRE    42173795 1976/00/00  2.5   64    53 w 1    15 b 1    61 w 0     3 b 0    31 b =    24 w 0   109 b 0  
001   22 m    Kartsakis,Ioannis                 1666 GRE    42124034 2011/00/00  2.5   62     7 b 0    44 w 1    29 b 0    70 b 0    36 w 0    19 b =    59 w 1  
001   23 f    Serlidaki,Anastasia               1567 GRE    42154090 2013/00/00  3.0   49     8 w 1    45 b 0    30 w =    71 w 0    37 b 0    20 w 1    60 b =  
001   24 f    Remediaki,Sofia Niki              1460 GRE    42154324 2013/00/00  2.0   81     9 b 0    46 w 0    31 b 0    72 b 0    38 w 1    21 b 1    61 w 0  
001   25 m    Papachronakis,Ektoras             1573 GRE    42145406 2011/00/00  3.0   46    10 w 0    47 b =    32 w 1    79 w =    39 b 1    55 w 0    62 b 0  
001   26 m    Zachos,Konstantinos               1526 GRE    42174147 2014/00/00  4.5   17    11 b 1    48 w 1    33 b =    80 b 1    40 w 1    56 b 0    63 w 0  
001   27 f    Vertoudou,Syllia Eleftheria       1464 GRE    42153999 2014/00/00  7.0    1    12 w 1    49 b 1    34 w 1    81 w 1    41 b 1    57 w 1    64 b 1  
001   28 m    Zografinis,Dimitrios              1483 GRE    42178347 2012/00/00  0.0   89  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   29 f    Chasouraki,Chrysi                 1756 GRE    25861123 2009/00/00  5.5    3    84 w 1    99 b 0    22 w 1    59 b 1    19 w =     1 b 1    70 w 1  
001   30 m    Disha,Beshim                      1964 ALB     4700937 1965/00/00  4.0   22    85 b +   100 w 0    23 b =    60 w 1    20 b =     2 w 1    71 b 0  
001   31 m    Markakis,Georgios                 1703 GRE     4260104 1962/00/00  4.5   10  0000 - -   101 b 0    24 w 1    61 b 1    21 w =     3 b 1    72 w 0  
001   32 m    Gkitsas,Stergios                  1641 GRE    42198208 1990/00/00  4.0   31    86 b 1   102 w 1    25 b 0    62 w 0    55 b 1     4 w 1    79 b 0  
001   33 m    Papandreou,Nikolaos               1654 GRE     4202678 1961/00/00  4.0   24    87 w 1   103 b 1    26 w =    63 b 0    56 w 1     5 b 0    80 w =  
001   34 m    Lantzourakis,Nikolaos             1454 GRE    25865307 2006/00/00  3.5   39    88 b 1   104 w 1    27 b 0    64 w 0    57 b 1     6 w 0    81 b =  
001   35 f    Vourtsa,Georgia                   1857 GRE     4214510 1989/00/00  0.0   90  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   36 m    Domosidis,Ioannis                 1467 GRE    42144752 1989/00/00  3.5   42    92 b 0  0000 - -    13 w =    99 w 1    22 b 1   107 w 1    51 b 0  
001   37 m    Chasourakis,Emmanouil             1557 GRE    25844784 2005/00/00  2.5   72    93 w 0  0000 - -    14 b =   100 b =    23 w 1   108 b 0    52 w =  
001   38 m    Androulakis,Emmanouil I           1512 GRE    42155274 1999/00/00  1.0   86    94 b 0  0000 - -    15 w =   101 w =    24 b 0   109 w 0    53 b 0  
001   39 m    Lantzourakis,Theocharis           0000 GRE    42126070 1965/00/00  2.5   69    95 w 1  0000 - -    16 b 1   102 b =    25 w 0   110 b 0    54 w 0  
001   40 m    Archontopoulos,Ilias              0000 GRE           0             1.0   83    96 b 0  0000 - -    17 w 1   103 w 0    26 b 0   111 w 0    73 b 0  
001   41 f    Girvalaki,Nektaria                1412 GRE    42193958 1974/00/00  1.0   87    97 w 0  0000 - -    18 b 0   104 b 0    27 w 0  0000 - -    74 w -  
001   42 f    Volosyraki,Anna                   0000 GRE    42179505 2015/00/00  0.0   91  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   43 m    Volosyrakis,Methodios             0000 GRE           0             0.0   92  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   44 m    Gratseas,Stefanos                 1981 GRE     4201175 1962/00/00  3.0   55    13 w 1    22 b 0    51 w 1     7 w 0    92 b 1    70 b 0    99 w 0  
001   45 m    Georgakakis,Michail               1818 GRE    25835190 2005/00/00  4.0   32    14 b 1    23 w 1    52 b 1     8 b 0    93 w 1    71 w 0   100 b 0  
001   46 f    Fitsaki,Elisavet                  0000 GRE    42163102 2014/00/00  3.0   56    15 w 0    24 b 1    53 w 0     9 w 0    94 b 1    72 b 1   101 w 0  
001   47 m    Karozas,Dimitrios                 0000 GRE    42163110 2013/00/00  4.5   14    16 b 0    25 w =    54 b =    10 b 1    95 w 1    79 w =   102 b 1  
001   48 m    Linoxilakis,Evaggelos             0000 GRE           0             2.5   63    17 w 1    26 b 0    73 w =    11 w 1    96 b 0    80 b 0   103 w 0  
001   49 m    Pilaftsis,Stefanos                0000 GRE    42191980 2014/00/00  1.5   82    18 b 0    27 w 0    74 b =    12 b 1    97 w 0    81 w 0   104 b 0  
001   50 m    Karalis,Vasileios                 0000 GRE           0             0.0   93  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   51 m    Milonakis,Georgios                2053 GRE     4206320 1982/00/00  1.0   84    19 b 0   107 w 0    44 b 0    92 w 0  0000 - -    84 b 0    36 w 1  
001   52 f    Theodoroglaki,Varvara             1439 GRE    25882333 2010/00/00  0.5   88    20 w 0   108 b 0    45 w 0    93 b 0  0000 - -    85 w 0    37 b =  
001   53 m    Theodoroglakis,Ioannis            1682 GRE    25861441 2008/00/00  3.0   60    21 b 0   109 w 0    46 b 1    94 w 0  0000 - -  0000 - -    38 w 1  
001   54 f    Meletaki,Angeliki                 0000 GRE    42143365 1976/00/00  3.0   54    55 w =   110 b 1    47 w =    95 b 0  0000 - -    86 w 0    39 b 1  
001   55 m    Rakitzis,Petros                   1522 GRE    42178665 1970/00/00  3.0   47    54 b =    16 w 1    62 b 0     4 w =    32 w 0    25 b 1   110 w 0  
001   56 m    Saklampanakis,Ioannis             1447 GRE    42181550 1971/00/00  5.0    5    73 w 0    17 b 1    63 w 1     5 b 1    33 b 0    26 w 1   111 b 1  
001   57 m    Chatzisavvas,Georgios             1428 GRE    42159601 1977/00/00  4.0   23    74 b 1    18 w 1    64 b 0     6 w 1    34 w 0    27 b 0  0000 - -  
001   58 m    Chatzikonstantinou,Myrto          0000 GRE           0 1981/00/00  0.0   94  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   59 m    Emmanouilidis,Konstantinos        1951 GRE     4260260 1979/00/00  4.0   29    70 b 1    92 w 1    19 b 0    29 w 0     1 w 1    99 b 1    22 b 0  
001   60 m    Makris,Georgios 47996             1772 GRE    25868608 2008/00/00  3.5   35    71 w 1    93 b 1    20 w 0    30 b 0     2 b 1   100 w 0    23 w =  
001   61 f    Saklampanaki,Eleni                1445 GRE    25859994 2009/00/00  6.0    2    72 b 1    94 w 1    21 b 1    31 w 0     3 w 1   101 b 1    24 b 1  
001   62 m    Saklampanakis,Dimitrios           1757 GRE    25856308 2008/00/00  5.0    6    79 w 1    95 b =    55 w 1    32 b 1     4 b 0   102 w =    25 w 1  
001   63 m    Sergakis,Leonidas                 1860 GRE     4288181 1969/00/00  3.0   44    80 b 0    96 w =    56 b 0    33 w 1     5 w 0   103 b =    26 b 1  
001   64 f    Papadaki,Niki                     1473 GRE    42145414 2010/00/00  3.0   45    81 w 0    97 b =    57 w 1    34 b 1     6 b 0   104 w =    27 w 0  
001   65 f    Archontiki,Ioanna Markella        1510 GRE    42163099 2002/00/00  0.0   95  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   66 m    Diamantis,Angelos                 1661 GRE    25874390 2007/00/00  0.0   96  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   67 m    Katharios,Thomas                  0000 GRE    42179696 2011/00/00  0.0   97  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   68 f    Prokopaki,Elisso                  0000 GRE    42140722 2012/00/00  0.0   98  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   69 m    Bakalis,Konstantinos              1634 GRE    42105420 2010/00/00  0.0   99  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   70 f    Christodoulaki,Antonia Em         0000 GRE    42182506 2012/00/00  2.5   65    59 w 0    84 b 0    92 b =    22 w 1    99 b 0    44 w 1    29 b 0  
001   71 m    Christodoulakis,Michail Em        1728 GRE    42148537 2012/00/00  3.5   40    60 b 0    85 w 0    93 w =    23 b 1   100 w 0    45 b 1    30 w 1  
001   72 m    Kalligeris,Ioannis                1500 GRE    42148553 2014/00/00  4.0   25    61 w 0  0000 - -    94 b 1    24 w 1   101 b 0    46 w 0    31 b 1  
001   73 m    Stavroulakis,Nikolaos             1494 GRE    25852868 1992/00/00  4.5   18    56 b 1   111 w 1    48 b =    96 w 1  0000 - -    87 b 0    40 w 1  
001   74 m    Voulgarakis,Ioannis               1706 GRE    25829432 2004/00/00  3.0   61    57 w 0  0000 - -    49 w =    97 b 1  0000 - -    88 w =    41 b -  
001   75 f    Stratigi,Evangelia                1713 GRE     4248961 2000/00/00  0.0  100  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   76 m    Koumis,Filippos                   1691 GRE     4263510 1980/00/00  0.0  101  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   77 m    Maglitsa,Nikola                   1561 GRE    25861328 2009/00/00  0.0  102  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   78 m    Papanastasiou,Christos            1529 GRE    42145945 2002/00/00  0.0  103  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   79 m    Gkouvras,Konstantinos             1483 GRE    42171814 2015/00/00  4.5   11    62 b 0    86 w 1    95 w 1    25 b =   102 w =    47 b =    32 w 1  
001   80 m    Antonakis,Lykourgos               1534 GRE    42148499 2014/00/00  4.5   12    63 w 1    87 b 1    96 b =    26 w 0   103 b =    48 w 1    33 b =  
001   81 m    Skoulas,Stavros                   1443 GRE    42177251 2015/00/00  4.5   13    64 b 1    88 w 1    97 w =    27 b 0   104 w =    49 b 1    34 w =  
001   82 m    Skoulas,Dimitrios                 0000 GRE    42190967 2018/00/00  0.0  104  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   83 m    Psarianos,Apostolos               0000 GRE           0             0.0  105  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   84 m    Kavouras,Kosmas                   1552 GRE    25870742 1984/00/00  3.0   50    29 b 0    70 w 1  0000 - -    13 b 0   107 b 0    51 w 1     7 w 1  
001   85 m    Tsagkarakis,Defkalion             1477 GRE    42138370 2010/00/00  3.0   57    30 w -    71 b 1  0000 - -    14 w 0   108 w 0    52 b 1     8 b 1  
001   86 m    Tripias,Angelos                   1515 GRE    42147115 2013/00/00  2.0   78    32 w 0    79 b 0  0000 - -    16 w 0   110 w 0    54 b 1    10 b 1  
001   87 f    Theodosouli,Eleanna               1430 GRE    42124301 2010/00/00  2.0   79    33 b 0    80 w 0  0000 - -    17 b 0   111 b 0    73 w 1    11 w 1  
001   88 m    Chatzisavvas,Nikolaos             1503 GRE    42124247 2012/00/00  2.5   74    34 w 0    81 b 0  0000 - -    18 w =  0000 - -    74 b =    12 b =  
001   89 m    Koiladis,Emmnaouil                0000 GRE           0 2015/00/00  0.0  106  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   90 m    Maris,Ioannis                     1874 GRE     4201540 1947/00/00  0.0  107  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   91 m    Lygerakis,Ioannis                 0000 GRE           0             0.0  108  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   92 m    Klokas,Konstantinos               1994 GRE     4206932 1976/00/00  2.5   73    36 w 1    59 b 0    70 w =    51 b 1    44 w 0    13 b 0  0000 - -  
001   93 m    Bras,Emanouel                     1858 GRE     4203771 1961/00/00  3.0   58    37 b 1    60 w 0    71 b =    52 w 1    45 b 0    14 w =  0000 - -  
001   94 m    Barberakis,Konstantinos           1727 GRE     4239768 1991/00/00  2.5   71    38 w 1    61 b 0    72 w 0    53 b 1    46 w 0    15 b =  0000 - -  
001   95 f    Kloka,Aliki                       1465 GRE    42163129 2014/00/00  2.0   75    39 b 0    62 w =    79 b 0    54 w 1    47 b 0    16 w =  0000 - -  
001   96 f    Bakali,Anastasia                  1421 GRE    42154294 2014/00/00  3.0   51    40 w 1    63 b =    80 w =    73 b 0    48 w 1    17 b 0  0000 - -  
001   97 f    Venieri,Artemis                   0000 GRE    42199409 2015/00/00  3.0   59    41 b 1    64 w =    81 b =    74 w 0    49 b 1    18 w 0  0000 - -  
001   98 m    Venieris,Orfeas                   0000 GRE    42199395 2015/00/00  0.0  109  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001   99 m    Kadianis,Georgios                 1957 GRE     4264681 2000/00/00  3.0   48   107 b 0    29 w 1     1 w 0    36 b 0    70 w 1    59 w 0    44 b 1  
001  100 m    Venianakis,Nikolaos               1581 GRE    42146011 2001/00/00  4.5    9   108 w 0    30 b 1     2 b 0    37 w =    71 b 1    60 b 1    45 w 1  
001  101 f    Stremougkou,Eirini                0000 GRE    42199387 2000/00/00  4.0   26   109 b =    31 w 1     3 w 0    38 b =    72 w 1    61 w 0    46 b 1  
001  102 m    Galatis,Pantelis                  1631 GRE    25865447 1995/00/00  3.5   36   110 w 1    32 b 0     4 b 1    39 w =    79 b =    62 b =    47 w 0  
001  103 m    Zacharioudakis,Iasonas            0000 GRE    42173833 2011/00/00  5.0    7   111 b 1    33 w 0     5 w 1    40 b 1    80 w =    63 w =    48 b 1  
001  104 m    Tzitzikas,Titos                   1521 GRE    42105471 2009/00/00  4.5   20  0000 - -    34 b 0     6 b =    41 w 1    81 b =    64 b =    49 w 1  
001  105 m    Koukakis,Emmanouil                1519 GRE    42181500 2008/00/00  0.0  110  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  106 m    Fasoulakis,Georgios               1406 GRE    42178452 2014/00/00  0.0  111  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  107 f    Kontaki,Maria                     1465 GRE     4237234 1959/00/00  3.0   52    99 w 1    51 b 1     7 b 0  0000 - -    84 w 1    36 b 0    19 w 0  
001  108 m    Malliotakis,Mihail                1585 GRE     4251679 1988/00/00  4.5   15   100 b 1    52 w 1     8 w =  0000 - -    85 b 1    37 w 1    20 b 0  
001  109 m    Dialynas,Nikolaos                 0000 GRE           0 2017/00/00  5.0    8   101 w =    53 b 1     9 b =  0000 - -  0000 - -    38 b 1    21 w 1  
001  110 m    Garefalakis,Nikitas               0000 GRE    42191947 2016/00/00  3.5   43   102 b 0    54 w 0    10 w =  0000 - -    86 b 1    39 w 1    55 b 1  
001  111 m    Garefalakis,Emmanouil             0000 GRE           0 2018/00/00  3.0   53   103 w 0    73 b 0    11 b 1  0000 - -    87 w 1    40 b 1    56 w 0  
001  112 f    Galetaki,Eirini                   0000 GRE    42175879 2015/00/00  0.0  112  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  113 m    Falinski,Sergios                  0000 GRE           0 2014/00/00  0.0  113  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  114 m    Falinski,Maximos                  0000 GRE           0 2017/00/00  0.0  114  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  115 m    Oikonomakis,Paris                 0000 GRE           0 2014/00/00  0.0  115  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  116 m    Katsibris,Emmanouil               0000 GRE           0             0.0  116  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  117 m    Loukaki,Eleni                     0000 GRE           0             0.0  117  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  118 m    Tripia,Aikaterini                 0000 GRE           0 1979/00/00  0.0  118  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  119 m    Zachos,Georgios                   0000 GRE           0 1971/00/00  0.0  119  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  120 m    Agnantis,Dimitrios                1756 GRE     4229126 1969/00/00  0.0  120  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  121 f    Diamanti,Eleni                    1507 GRE    25874381 2007/00/00  0.0  121  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  122 m    Grammenos,Nikolaos                0000 GRE           0 2015/00/00  0.0  122  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  123 m    Petsalaki,Eleni                   0000 GRE           0 1986/00/00  0.0  123  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  124 m    Rakitzaki,Maria                   0000 GRE           0 1983/00/00  0.0  124  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  125 m    Garefalakis,Vlassis               0000 GRE           0 1976/00/00  0.0  125  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  126 m    Apostolopoulos,Sergios            0000 GRE           0 2009/00/00  0.0  126  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  127 f    Meletaki,Aggeliki                 0000 GRE    42143365 1976/00/00  0.0  127  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  128 f    Bagetakou,Chrysi Nikoleta         0000 GRE    42172268 2013/00/00  0.0  128  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  
001  129 f    Karkani,Maria Faidra              1458 GRE    42190878 2015/00/00  0.0  129  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  0000 - -  

013 ΓΑΖΙ 1                            13   14   15   16   17   18   90  129
013 Α.Π.Ο. ΜΙΚΗΣ ΘΕΟΔΩΡΑΚΗΣ            7    8    9   10   11   12   83  120
013 ΟΑΑΗ                              59   60   61   62   63   64   65   66   67   68   69  121
013 ΣΟΗ                               29   30   31   32   33   34   35
013 ΚΥΔΩΝ                             51   52   53   54   73   74   75   76   77   78
013 ΛΕΩΝ ΚΑΝΤΙΑ 1                     92   93   94   95   96   97   98
013 ΟΦΗ 1                             99  100  101  102  103  104  105  117  126
013 ΓΑΖΙ 3                            44   45   46   47   48   49   50   91
013 ΟΦΗ 2                             22   23   24   25   26   27   28  119  123
013 ΟΑΧ                               70   71   72   79   80   81   82
013 ΓΑΖΙ 2                            84   85   86   87   88   89  106  118  124
013 ΛΕΩΝ ΚΑΝΤΙΑ 2                     19   20   21   55   56   57   58
013 Α.Σ.ΗΡΟΔΟΤΟΣ                      36   37   38   39   40   41   42   43  125  127
013 Σ.A.ΧΕΡΣΟΝΗΣΟΥ                   107  108  109  110  111  112  113  114  115  116  122
013 ΣΑΧ                                1    2    3    4    5    6  128"""


@transaction.atomic
def seed_complete_tournament(existing_league=None):
    """
    Create a complete tournament from TRF16 data using tournament_core structures.

    Args:
        existing_league: Optional existing League to use instead of creating new
    """
    print("=== Seeding complete tournament from TRF16 ===")

    # Create converter and parse TRF16
    converter = TRF16Converter(TRF16_DATA)
    converter.parse()

    # Create tournament builder
    builder = converter.create_tournament_builder()

    # Add all rounds
    converter.add_rounds_to_builder(builder)

    # Build the tournament structure
    tournament = builder.build()

    print(
        f"Built tournament with {len(tournament.competitors)} competitors and {len(tournament.rounds)} rounds"
    )

    # Convert structure to database
    result = structure_to_db(builder, existing_league)

    # Print final standings
    print("\n=== Final Standings ===")
    results = tournament.calculate_results()

    # Sort by match points
    sorted_teams = sorted(
        results.items(),
        key=lambda x: (x[1].match_points, x[1].game_points),
        reverse=True,
    )

    for i, (team_id, score) in enumerate(sorted_teams, 1):
        # Find team name
        team_name = None
        for name, info in builder.metadata.teams.items():
            if info["id"] == team_id:
                team_name = name
                break
        if team_name:
            print(
                f"{i}. {team_name}: {score.match_points} match points, {score.game_points} game points"
            )

    return result["season"]


@transaction.atomic
def seed_progressive_tournament(
    num_rounds=1, include_results=True, existing_league=None
):
    """
    Create a tournament progressively with specified number of rounds.

    Args:
        num_rounds: Number of rounds to create
        include_results: Whether to include results or just pairings
        existing_league: Optional existing League to use
    """
    print(
        f"=== Seeding {num_rounds} rounds {'with results' if include_results else 'pairings only'} ==="
    )

    # Create converter and parse TRF16
    converter = TRF16Converter(TRF16_DATA)
    converter.parse()

    # Create tournament builder
    builder = converter.create_tournament_builder()

    # Add specified rounds
    if include_results:
        converter.add_rounds_to_builder(
            builder, rounds_to_add=list(range(1, num_rounds + 1))
        )
    else:
        # For pairings only, we'd need to modify the converter
        # For now, just add with results
        converter.add_rounds_to_builder(
            builder, rounds_to_add=list(range(1, num_rounds + 1))
        )

    # Convert to database
    result = structure_to_db(builder, existing_league)

    return result["season"]


# Convenience functions
def seed_teams_only(existing_league=None):
    """Create only teams without any rounds."""
    print("=== Seeding teams only ===")

    # Create converter and parse TRF16
    converter = TRF16Converter(TRF16_DATA)
    converter.parse()

    # Create tournament builder with just teams
    builder = converter.create_tournament_builder()

    # Don't add any rounds

    # Convert to database
    result = structure_to_db(builder, existing_league)

    print(f"Created {len(result['teams'])} teams")
    return result["season"]


def seed_first_n_rounds(n, existing_league=None):
    """Create teams and first n rounds with results."""
    return seed_progressive_tournament(
        n, include_results=True, existing_league=existing_league
    )
