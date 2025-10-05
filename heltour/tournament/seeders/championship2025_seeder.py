"""
TRF16-based tournament seeder for the 2025 Crete Championship.

This seeder imports the "Διασυλλογικό Πρωτάθλημα Π.Ο.Α Κρήτης 2025" tournament.
"""

from heltour.tournament_core.trf16_converter import TRF16Converter
from heltour.tournament.structure_to_db import structure_to_db
from django.db import transaction


# Embedded TRF16 data for 2025 Championship
TRF16_DATA = """012 Διασυλλογικό Πρωτάθλημα Π.Ο.Α Κρήτης 2025 
022 Heraklion
032 GRE
042 2025/03/16
052 2025/04/04
062 163 (73)
072 121
082 8
092 Team Swiss System
102 FA Stefanatos Charalabos
112 Gkizis Konstantinos
112 Sgouros Nikolaos, Magoulianos Georgios, Petrakis Iosif, Sfinias Nektarios, Gkizis Konstantinos, Psentelis Panagiotis
122 90 minutes plus 30 sec plus 30 min after 40 moves
142 4
132                                                                                        25/03/16  25/03/22  25/03/23  25/04/04

001    1 m    Naoum,Spyridon                    2359 GRE     4227506 1997/00/00  3.0   15    96 w 1    36 b 0   117 w 1    76 w 1  
001    2 m    Liodakis,Konstantinos-Spyros      2212 GRE     4217136 1996/00/00  3.0    7    97 b 1    37 w 0   118 b 1    77 b 1  
001    3 m    Georgakopoulos,Nikolaos K.        2140 GRE     4283430 2002/00/00  2.0   38    98 w 1    38 b 0   119 w 1    78 w 0  
001    4 m    Serntedakis,Athanasios            2108 GRE     4239423 1993/00/00  2.0   45    99 b 1    39 w 1   120 b 0    79 b 0  
001    5 m    Tsarouchas,Konstantinos           2106 GRE     4201094 1964/00/00  2.0   39   100 w 1    40 b 0   121 w 1    80 w 0  
001    6 m    Papadopoulos,Argirios             2084 GRE     4241509 1999/00/00  2.0   31   101 b 1    41 w 1   122 b 0    81 b 0  
001    7 f    Vozinaki,Anathi-Maria             1970 GRE     4263898 2001/00/00  1.5   55   102 w =    42 b 1   123 w 0    82 w 0  
001    8 f    Karavitaki,Antonia                1714 GRE    25820125 2007/00/00  2.0   40   103 b 0    43 w 1   124 b 0    83 b 1  
001    9 f    Karavitaki,Evaggelia              1923 GRE     4295021 2005/00/00  0.0   77   104 w 0    44 b 0   125 w 0    84 w 0  
001   10 f    Psarianou,Eleni                   1695 GRE    25882392 2011/00/00  3.0   13   105 b 1    45 w 1   126 b 1    85 b 0  
001   11 f    Skaraki,Georgia                   1683 GRE    25861190 2008/00/00  0.0   79  0000 - -  0000 - -  0000 - -  0000 - -  
001   12 f    Volani,Olga                       1623 GRE    42154529 2014/00/00  0.0   80  0000 - -  0000 - -  0000 - -  0000 - -  
001   13 m    Schetakis,Georgios                1545 GRE    42106028 2010/00/00  0.0   81  0000 - -  0000 - -  0000 - -  0000 - -  
001   14 m    Xeras,Ioannis                     1474 GRE    42149584 2015/00/00  0.0   82  0000 - -  0000 - -  0000 - -  0000 - -  
001   15 m    Diakoloukas,Theodosios            1460 GRE    42154189 2013/00/00  0.0   83  0000 - -  0000 - -  0000 - -  0000 - -  
001   16 m    Fraidakis,Matthaios Ioannis       1456 GRE    42172357 2013/00/00  0.0   84  0000 - -  0000 - -  0000 - -  0000 - -  
001   17 m    Lampousakis,Michail               1445 GRE    42189217 2015/00/00  0.0   85  0000 - -  0000 - -  0000 - -  0000 - -  
001   18 m    Fragkakis,Georgios                0000 GRE    42172365 2017/00/00  0.0   86  0000 - -  0000 - -  0000 - -  0000 - -  
001   19 f    Kouvedaki,Rafaela                 0000 GRE    42173701 2016/00/00  0.0   87  0000 - -  0000 - -  0000 - -  0000 - -  
001   20 f    Psilopoulou,Anna-Maria            0000 GRE    42194580 2012/00/00  0.0   88  0000 - -  0000 - -  0000 - -  0000 - -  
001   21 m    Rizos,Dimitrios Chania            1583 GRE    42106036 2010/00/00  0.0   89  0000 - -  0000 - -  0000 - -  0000 - -  
001   22 m    Volanis,Vasileios                 1444 GRE    42177294 2018/00/00  0.0   90  0000 - -  0000 - -  0000 - -  0000 - -  
001   23 m    Stefanatos,Nikolaos               1922 GRE     4223101 1992/00/00  2.0   34   117 w 1    76 w 1    96 b 0    56 b 0  
001   24 m    Gratseas,Stefanos                 1962 GRE     4201175 1962/00/00  1.5   61   118 b =    77 b 0    97 w 1    57 w 0  
001   25 f    Karkani,Maria-Faidra              0000 GRE    42190878 2015/00/00  0.5   75   120 b =    79 b -    99 w 0    59 w 0  
001   26 m    Lirindzakis,Timotheos             2085 GRE     4200381 1960/00/00  2.5   26   121 w 1    80 w 0   100 b =    60 b 1  
001   27 m    Spirou,Gerasimos                  1822 GRE     4239814 1987/00/00  1.5   56   122 b =    81 b 0   101 w 0    61 w 1  
001   28 m    Fragiadakis,Emanouel              1804 GRE     4204026 1975/00/00  3.0   14   123 w +    82 w 0   102 b 1    62 b 1  
001   29 f    Theodosouli,Eleanna               1436 GRE    42124301 2010/00/00  3.0    5   124 b 1    83 b 0   103 w 1    63 w 1  
001   30 f    Argyroudi,Nefeli                  1421 GRE    42133491 2009/00/00  1.5   58   125 w =    84 w 0   104 b 1    64 b 0  
001   31 m    Georgakakis,Michail               1877 GRE    25835190 2005/00/00  0.0   91  0000 - -  0000 - -  0000 - -  0000 - -  
001   32 m    Tsagkarakis,Defkalion             1539 GRE    42138370 2010/00/00  0.0   92  0000 - -  0000 - -  0000 - -  0000 - -  
001   33 m    Mihopoulos,Konstantinos           2054 GRE     4217110 1993/00/00  0.0   93  0000 - -  0000 - -  0000 - -  0000 - -  
001   34 m    Chatzisavvas,Nikolaos             1463 GRE    42124247 2012/00/00  0.0   94  0000 - -  0000 - -  0000 - -  0000 - -  
001   35 m    Linoxilakis,Evangelos             0000 GRE   541003373 2014/00/00  0.0   95  0000 - -  0000 - -  0000 - -  0000 - -  
001   36 m    Katzourakis,Pavlos                2149 GRE     4203798 1978/00/00  1.0   68    56 b 0     1 w 1    76 b 0   137 w 0  
001   37 m    Fragakis,Efstratios               2120 GRE     4206592 1989/00/00  3.0    6    57 w 1     2 b 1    77 w 0   138 b 1  
001   38 m    Verikakis,Manolis                 2025 GRE     4211901 1989/00/00  3.0   19    58 b =     3 w 1    78 b =   139 w 1  
001   39 m    Gasparakis,Georgios               2014 GRE     4201760 1975/00/00  2.0   32    59 w 1     4 b 0    79 w 1   140 b 0  
001   40 f    Markaki,Sofia                     1831 GRE     4248848 1997/00/00  2.5   22    60 b 0     5 w 1    80 b =   141 w 1  
001   41 f    Agnanti,Danai                     1733 GRE     4231147 1995/00/00  1.0   69    61 w 1     6 b 0    81 w 0   142 b 0  
001   42 m    Agnantis,Dimitrios                1784 GRE     4229126 1969/00/00  3.0   20    62 b 1     7 w 0    82 b 1   143 w 1  
001   43 m    Bairamian,Artur                   1871 GRE     4295064 2004/00/00  0.0   78    63 w 0     8 b 0    83 w 0   144 b 0  
001   44 m    Hatzidakis,Nikolaos               1734 GRE     4252659 1994/00/00  3.0   11    64 b 1     9 w 1    84 b 1   145 w 0  
001   45 f    Manousoudaki,Eleni                1542 GRE    25886428 2009/00/00  2.0   41    65 w 1    10 b 0    85 w 0   146 b 1  
001   46 m    Tripodakis,Emmanouil              1570 GRE    42197740 1984/00/00  0.0   96  0000 - -  0000 - -  0000 - -  0000 - -  
001   47 f    Anastasopoulou,Stavroula          1462 GRE    42177235 2011/00/00  0.0   97  0000 - -  0000 - -  0000 - -  0000 - -  
001   48 m    Lavdakis,Michail                  1426 GRE    42163153 2013/00/00  0.0   98  0000 - -  0000 - -  0000 - -  0000 - -  
001   49 m    Bouchlis,Nikolaos                 0000 GRE    42183219 2014/00/00  0.0   99  0000 - -  0000 - -  0000 - -  0000 - -  
001   50 m    Ouzounstefanis,Ioannis            0000 GRE    42154197 2013/00/00  0.0  100  0000 - -  0000 - -  0000 - -  0000 - -  
001   51 m    Pariotakis,Georgios               0000 GRE    42129729 2012/00/00  0.0  101  0000 - -  0000 - -  0000 - -  0000 - -  
001   52 f    Gagani,Elli                       1409 GRE    42172349 2015/00/00  0.0  102  0000 - -  0000 - -  0000 - -  0000 - -  
001   53 m    Psarianos,Emmanouil               1451 GRE    42143683 2014/00/00  0.0  103  0000 - -  0000 - -  0000 - -  0000 - -  
001   54 f    Bagetakou,Chrysi-Nikoleta         0000 GRE    42172268 2013/00/00  0.0  104  0000 - -  0000 - -  0000 - -  0000 - -  
001   55 m    Protosygkelos,Ioakeim             0000 GRE           0 2005/00/00  0.0  105  0000 - -  0000 - -  0000 - -  0000 - -  
001   56 m    Galanakis,Mihail                  1793 GRE     4221206 1991/00/00  2.0   35    36 w 1    96 b 0   137 b 0    23 w 1  
001   57 f    Meletaki,Aggeliki                 0000 GRE    42143365 1976/00/00  2.0   48    37 b 0    97 w 1   138 w 0    24 b 1  
001   58 m    Voulgarakis,Ioannis               1770 GRE    25829432 2004/00/00  1.5   62    38 w =    98 b 0   139 b 0  0000 - -  
001   59 m    Koumis,Filippos                   1699 GRE     4263510 1980/00/00  2.0   36    39 b 0    99 w 1   140 w 0    25 b 1  
001   60 m    Stavroulakis,Nikolaos             1604 GRE    25852868 1992/00/00  2.0   42    40 w 1   100 b 1   141 b 0    26 w 0  
001   61 m    Koukoutsakis,Georgios             1486 GRE     4289609 2001/00/00  0.5   73    41 b 0   101 w 0   142 w =    27 b 0  
001   62 m    Papanastasiou,Christos            1517 GRE    42145945 2002/00/00  0.0   76    42 w 0   102 b 0   143 b 0    28 w 0  
001   63 m    Androulakis,Aristeidis Nik        1521 GRE    25868683 1975/00/00  2.0   43    43 b 1   103 w 0   144 w 1    29 b 0  
001   64 f    Loukaki,Chrysoula                 0000 GRE    25829840 2006/00/00  3.0    8    44 w 0   104 b 1   145 b 1    30 w 1  
001   65 m    Matonaki,Evaggelia                0000 GRE           0 2016/00/00  2.0   52    45 b 0   105 w 0   146 w 1  0000 - -  
001   66 m    Stamataki,Eleanna                 1466 GRE    42178444 2012/00/00  0.0  106  0000 - -  0000 - -  0000 - -  0000 - -  
001   67 m    Maglitsa,Nikola                   0000 GRE    25861328 2009/00/00  0.0  107  0000 - -  0000 - -  0000 - -  0000 - -  
001   68 m    Sampanis,Athanasios               1683 GRE    25851160 2008/00/00  0.0  108  0000 - -  0000 - -  0000 - -  0000 - -  
001   69 m    Karamintzios,Georgios             0000 GRE    42197082 2012/00/00  0.0  109  0000 - -  0000 - -  0000 - -  0000 - -  
001   70 m    Archoleon,Nikolaos                0000 GRE    42184266 2013/00/00  0.0  110  0000 - -  0000 - -  0000 - -  0000 - -  
001   71 m    Koumakis,Odysseas                 0000 GRE    42189306 2016/00/00  0.0  111  0000 - -  0000 - -  0000 - -  0000 - -  
001   72 f    Vakali,Ariadni                    1478 GRE    25829866 2006/00/00  0.0  112  0000 - -  0000 - -  0000 - -  0000 - -  
001   73 m    Simantirakis,Apolon               1890 GRE    25801767 1981/00/00  0.0  113  0000 - -  0000 - -  0000 - -  0000 - -  
001   74 f    Paizi,Myrsini                     0000 GRE    42106060 2010/00/00  0.0  114  0000 - -  0000 - -  0000 - -  0000 - -  
001   75 m    Paizis,Alexandros                 0000 GRE    42149096 2012/00/00  0.0  115  0000 - -  0000 - -  0000 - -  0000 - -  
001   76 m    Darmarakis,Mihail                 2246 GRE     4203720 1979/00/00  2.0   37   137 w 1    23 b 0    36 w 1     1 b 0  
001   77 m    kalaitzoglou,Panayotis            2115 GRE     4202422 1976/00/00  3.0    9   138 b 1    24 w 1    37 b 1     2 w 0  
001   78 m    Liargovas,Dimitrios               1991 GRE     4214374 1991/00/00  2.5   23   139 w 0  0000 - -    38 w =     3 b 1  
001   79 m    Mavridis,Emmanouil                1900 GRE    25840053 2009/00/00  1.5   57   140 b =    25 w -    39 b 0     4 w 1  
001   80 m    Kalligeris,Ioannis                1679 GRE    42148553 2014/00/00  2.5   21   141 w 0    26 b 1    40 w =     5 b 1  
001   81 m    Benakis,Ioannis                   1835 GRE    25858360 2009/00/00  4.0    2   142 b 1    27 w 1    41 b 1     6 w 1  
001   82 f    Sgourou,Terpsichori               1520 GRE    25881744 2010/00/00  2.0   30   143 w 0    28 b 1    42 w 0     7 b 1  
001   83 f    Nikolozaki,Melina                 1470 GRE    25882287 2010/00/00  3.0   17   144 b 1    29 w 1    43 b 1     8 w 0  
001   84 f    Kleovoulou,Sofia                  1614 GRE    25861158 2009/00/00  2.0   44   145 w 0    30 b 1    44 w 0     9 b 1  
001   85 f    Christodoulaki,Antonia Emm        0000 GRE    42182506 2012/00/00  4.0    1   146 b 1  0000 - -    45 b 1    10 w 1  
001   86 m    Christodoulakis,Michail Em        1625 GRE    42148537 2012/00/00  0.0  116  0000 - -  0000 - -  0000 - -  0000 - -  
001   87 m    Kyriakogiannakis,Ioannis          1672 GRE    25861298 2009/00/00  0.0  117  0000 - -  0000 - -  0000 - -  0000 - -  
001   88 m    Theodorakis,Michalis              1845 GRE     4236750 1988/00/00  0.0  118  0000 - -  0000 - -  0000 - -  0000 - -  
001   89 f    Tsouba,Adamantia                  1732 GRE     4236548 1998/00/00  0.0  119  0000 - -  0000 - -  0000 - -  0000 - -  
001   90 m    Mavridis,Athanasios               1834 GRE    25840045 2006/00/00  0.0  120  0000 - -  0000 - -  0000 - -  0000 - -  
001   91 m    Skoulas,Stavros                   1443 GRE    42177251 2015/00/00  0.0  121  0000 - -  0000 - -  0000 - -  0000 - -  
001   92 m    Antonakis,Lykourgos               1419 GRE    42148499 2014/00/00  0.0  122  0000 - -  0000 - -  0000 - -  0000 - -  
001   93 m    Gkouvras,Konstantinos             1535 GRE    42171814 2015/00/00  0.0  123  0000 - -  0000 - -  0000 - -  0000 - -  
001   94 m    Gkogkas,Dimitrios                 2007 GRE     4200462 1961/00/00  0.0  124  0000 - -  0000 - -  0000 - -  0000 - -  
001   95 m    Metzidakis,Dimitrios              1531 GRE    42137969 2009/00/00  0.0  125  0000 - -  0000 - -  0000 - -  0000 - -  
001   96 m    Emmanouilidis,Konstantinos        2019 GRE     4260260 1979/00/00  3.0   12     1 b 0    56 w 1    23 w 1   117 b 1  
001   97 f    Diamanti,Eleni                    1509 GRE    25874381 2007/00/00  1.0   70     2 w 0    57 b 0    24 b 0   118 w 1  
001   98 m    Diamantis,Angelos                 1816 GRE    25874390 2007/00/00  2.0   53     3 b 0    58 w 1  0000 - -   119 b 0  
001   99 m    Makris,Georgios 47996             1765 GRE    25868608 2008/00/00  2.0   50     4 w 0    59 b 0    25 b 1   120 w 1  
001  100 m    Kotsoglou,Georgios                1756 GRE     4286049 2002/00/00  0.5   72     5 b 0    60 w 0    26 w =   121 b 0  
001  101 f    Kotsoglou,Evi                     1636 GRE     4260422 1999/00/00  2.0   49     6 w 0    61 b 1    27 b 1   122 w 0  
001  102 m    Sergakis,Leonidas                 1770 GRE     4288181 1969/00/00  2.5   28     7 b =    62 w 1    28 w 0   123 b 1  
001  103 m    Ontabasidis,Aristidis             1841 GRE     4248872 2000/00/00  3.0   10     8 w 1    63 b 1    29 b 0   124 w 1  
001  104 m    Thomakis,Nikolaos                 1688 GRE     4248996 1999/00/00  1.0   71     9 b 1    64 w 0    30 w 0   125 b 0  
001  105 m    Dadidakis,Elefterios              1809 GRE     4220935 1990/00/00  3.0   18    10 w 0    65 b 1  0000 - -   126 w 1  
001  106 m    Kolomvakis,Stelios                1894 GRE     4217500 1994/00/00  0.0  126  0000 - -  0000 - -  0000 - -  0000 - -  
001  107 f    Archontiki,Ioanna Markella        0000 GRE    42163099 2002/00/00  0.0  127  0000 - -  0000 - -  0000 - -  0000 - -  
001  108 f    Saklampanaki,Eleni                1511 GRE    25859994 2009/00/00  0.0  128  0000 - -  0000 - -  0000 - -  0000 - -  
001  109 m    Saklampanakis,Dimitrios           1819 GRE    25856308 2008/00/00  0.0  129  0000 - -  0000 - -  0000 - -  0000 - -  
001  110 f    Papadaki,Niki                     1460 GRE    42145414 2010/00/00  0.0  130  0000 - -  0000 - -  0000 - -  0000 - -  
001  111 f    Prokopaki,Elisso                  1517 GRE    42140722 2012/00/00  0.0  131  0000 - -  0000 - -  0000 - -  0000 - -  
001  112 f    Mamoulaki,Maria-Anastasia         0000 GRE    42179459 2017/00/00  0.0  132  0000 - -  0000 - -  0000 - -  0000 - -  
001  113 m    Mamoulakis,Charalampos Ch         0000 GRE    42189152 2016/00/00  0.0  133  0000 - -  0000 - -  0000 - -  0000 - -  
001  114 m    Bakalis,Konstantinos              1646 GRE    42105420 2010/00/00  0.0  134  0000 - -  0000 - -  0000 - -  0000 - -  
001  115 m    Potamitis,Rafail                  1576 GRE    42163161 2012/00/00  0.0  135  0000 - -  0000 - -  0000 - -  0000 - -  
001  116 m    Di Babbo,Massimo-Tomasso          0000 GRE    42189080 2015/00/00  0.0  136  0000 - -  0000 - -  0000 - -  0000 - -  
001  117 m    Papathanasiou,Panayotis           2002 GRE     4203232 1960/00/00  1.0   66    23 b 0   137 w 1     1 b 0    96 w 0  
001  118 m    Kavounis,Giorgos                  1784 GRE     4299353 2006/00/00  1.5   63    24 w =   138 b 1     2 w 0    97 b 0  
001  119 m    Katsogridakis,Stelios             1920 GRE     4251288 1960/00/00  3.0   16  0000 - -   139 w 1     3 b 0    98 w 1  
001  120 m    Mathioudakis,Iakovos              1428 GRE    42176859 2012/00/00  1.5   59    25 w =   140 b 0     4 w 1    99 b 0  
001  121 m    Kokolakis,Pavlos                  1427 GRE    42141109 2014/00/00  2.0   46    26 b 0   141 w 1     5 b 0   100 w 1  
001  122 m    Papalevyzakis,Emmanouil           1684 GRE    42135141 2003/00/00  2.5   24    27 w =   142 b 0     6 w 1   101 b 1  
001  123 f    Mytilinaiou,Zoi Alkmini           0000 GRE    42172306 2014/00/00  1.5   60    28 b -   143 w =     7 b 1   102 w 0  
001  124 m    Mytilinaios,Nikolaos              0000 GRE    42172314 2016/00/00  1.5   54    29 w 0   144 b =     8 w 1   103 b 0  
001  125 f    Kourtzeli,Anastasia Konstantina   0000 GRE     4297474 1987/00/00  2.5   29    30 b =   145 w 0     9 b 1   104 w 1  
001  126 m    Temetzian,Immanouel               1872 GRE    42162483 2008/00/00  1.5   65  0000 - -   146 b =    10 w 0   105 b 0  
001  127 m    Papadakis,Michalis G              1951 GRE     4254074 1975/00/00  0.0  137  0000 - -  0000 - -  0000 - -  0000 - -  
001  128 m    Sivaropoulos,Georgios             1532 GRE    25856367 2007/00/00  0.0  138  0000 - -  0000 - -  0000 - -  0000 - -  
001  129 m    Karabalis,Harilos                 2283 GRE     4621808 1969/00/00  0.0  139  0000 - -  0000 - -  0000 - -  0000 - -  
001  130 f    Tsakalaki,Kalliopi                1537 GRE    42105927 2012/00/00  0.0  140  0000 - -  0000 - -  0000 - -  0000 - -  
001  131 f    Koukouraki,Hrisi                  1647 GRE     4276124 2003/00/00  0.0  141  0000 - -  0000 - -  0000 - -  0000 - -  
001  132 m    Ntagkounakis,Emmanouil            1719 GRE    25881833 2009/00/00  0.0  142  0000 - -  0000 - -  0000 - -  0000 - -  
001  133 m    Sivaropoulos,Stefanos             1418 GRE    42151040 2014/00/00  0.0  143  0000 - -  0000 - -  0000 - -  0000 - -  
001  134 m    Girvalakis,Spyridon               1804 GRE     4207696 1978/00/00  0.0  144  0000 - -  0000 - -  0000 - -  0000 - -  
001  135 m    Pelantakis,Mihail                 1959 GRE     4294718 2003/00/00  0.0  145  0000 - -  0000 - -  0000 - -  0000 - -  
001  136 m    Alimpinisis,Nikolaos              1967 GRE     4251180 1970/00/00  0.0  146  0000 - -  0000 - -  0000 - -  0000 - -  
001  137 f    Polizou,Dionisia                  1912 GRE     4211669 1989/00/00  2.0   51    76 b 0   117 b 0    56 w 1    36 b 1  
001  138 m    Pasparakis,Lykourgos              0000 GRE           0 2012/00/00  1.0   67    77 w 0   118 w 0    57 b 1    37 w 0  
001  139 f    Spithouri,Foteini                 0000 GRE    42106648 2008/00/00  2.0   47    78 b 1   119 b 0    58 w 1    38 b 0  
001  140 f    Sfyri,OIympia                     1430 GRE    25800507 2004/00/00  3.5    3    79 w =   120 w 1    59 b 1    39 w 1  
001  141 f    Xilouri,Stefania                  0000 GRE    25895737 2008/00/00  2.0   33    80 b 1   121 b 0    60 w 1    40 b 0  
001  142 f    Panagiotaki,Efsaia                0000 GRE    42173566 2012/00/00  2.5   25    81 w 0   122 w 1    61 b =    41 w 1  
001  143 m    Ntagiantas,Alexandros             0000 GRE    42106567 2011/00/00  2.5   27    82 b 1   123 b =    62 w 1    42 b 0  
001  144 m    Manouras,Eleftherios              0000 GRE           0 2013/00/00  1.5   64    83 w 0   124 w =    63 b 0    43 w 1  
001  145 f    Chaireti,Eirini                   0000 GRE    42191009 2012/00/00  3.0    4    84 b 1   125 b 1    64 w 0    44 b 1  
001  146 m    Panagiotakis,Pantelis             0000 GRE           0 2016/00/00  0.5   74    85 w 0   126 w =    65 b 0    45 w 0  
001  147 m    Petrakis,Konstantinos G           0000 GRE    42199417 2017/00/00  0.0  147  0000 - -  0000 - -  0000 - -  0000 - -  
001  148 m    Logothetis,Sotirios               2108 GRE     4203267 1974/00/00  0.0  148  0000 - -  0000 - -  0000 - -  0000 - -  
001  149 m    Tzouvelekis,Ioannis               1941 GRE     4211022 1971/00/00  0.0  149  0000 - -  0000 - -  0000 - -  0000 - -  
001  150 m    Ntagiantas,Emmanouil              1755 GRE    25801880 1977/00/00  0.0  150  0000 - -  0000 - -  0000 - -  0000 - -  
001  151 m    Sarakenidis,Nikolaos              1919 GRE     4245865 1979/00/00  0.0  151  0000 - -  0000 - -  0000 - -  0000 - -  
001  152 m    Heretis,Georgios                  1678 GRE    25800434 2003/00/00  0.0  152  0000 - -  0000 - -  0000 - -  0000 - -  
001  153 m    Memos,Ioannis                     1791 GRE    25800469 2001/00/00  0.0  153  0000 - -  0000 - -  0000 - -  0000 - -  
001  154 m    Konios,Georgios                   1692 GRE    25838210 2007/00/00  0.0  154  0000 - -  0000 - -  0000 - -  0000 - -  
001  155 m    Ntagiantas,Dimitrios              0000 GRE     4297369 2004/00/00  0.0  155  0000 - -  0000 - -  0000 - -  0000 - -  
001  156 f    Goumenaki,Eva                     1471 GRE    25839896 2007/00/00  0.0  156  0000 - -  0000 - -  0000 - -  0000 - -  
001  157 f    Fitsaki,Elisavet                  0000 GRE    42163102 2014/00/00  0.0  157  0000 - -  0000 - -  0000 - -  0000 - -  
001  158 m    Tripias,Aggelos                   1572 GRE    42147115 2013/00/00  0.0  158  0000 - -  0000 - -  0000 - -  0000 - -  
001  159 f    Ntagianta,Maria                   0000 GRE    25818180 2009/00/00  0.0  159  0000 - -  0000 - -  0000 - -  0000 - -  
001  160 m    Spithouris,Ioannis                0000 GRE    42112427 2010/00/00  0.0  160  0000 - -  0000 - -  0000 - -  0000 - -  
001  161 f    Vertoudou,Syllia-Eleftheria       1426 GRE    42153999 2014/00/00  0.0  161  0000 - -  0000 - -  0000 - -  0000 - -  
001  162 m    Kallergis,Sofoklis                0000 GRE    42173612 2013/00/00  0.0  162  0000 - -  0000 - -  0000 - -  0000 - -  
001  163 f    Saloustrou,Despoina               0000 GRE    25800493 2003/00/00  0.0  163  0000 - -  0000 - -  0000 - -  0000 - -  

013 Σ.Α.Χ.                             1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22
013 ΣΚ.Ο.Ρ.                          117  118  119  120  121  122  123  124  125  126  127  128  129  130  131  132  133  134  135  136  156
013 Ο.Α.Χ.                            76   77   78   79   80   81   82   83   84   85   86   87   88   89   90   91   92   93   94   95
013 Α.Π.Ο.ΜΙΚΗΣ ΘΕΟΔΩΡΑΚΗΣ            36   37   38   39   40   41   42   43   44   45   46   47   48   49   50   51   52   53   54   55
013 Ο.Α.Α.Η.                          96   97   98   99  100  101  102  103  104  105  106  107  108  109  110  111  112  113  114  115  116
013 Σ.Α.ΓΑΖΙΟΥ                        23   24   25   26   27   28   29   30   31   32   33   34   35  157  158  161
013 Σ.Ο.ΑΝΩΓΕΙΩΝ                     137  138  139  140  141  142  143  144  145  146  148  149  150  151  152  153  154  155  159  160  162  163
013 Ο.Φ.Σ.Χ.                          56   57   58   59   60   61   62   63   64   65   66   67   68   69   70   71   72   73   74   75  147
"""


@transaction.atomic
def seed_complete_tournament(existing_league=None):
    """
    Create a complete tournament from TRF16 data using tournament_core structures.
    
    Args:
        existing_league: Optional existing League to use instead of creating new
    """
    print("=== Seeding 2025 Championship tournament from TRF16 ===")
    
    # Create converter and parse TRF16
    converter = TRF16Converter(TRF16_DATA)
    converter.parse()
    
    # Override the league tag to use "championship" instead of "TRF16"
    converter.header.tournament_name = "Crete Championship 2025"
    
    # Create tournament builder
    builder = converter.create_tournament_builder(league_tag="championship")
    
    # Override the league tag
    builder.metadata.league_tag = "championship"
    
    # Add all rounds
    converter.add_rounds_to_builder(builder)
    
    # Build the tournament structure
    tournament = builder.build()
    
    print(f"Built tournament with {len(tournament.competitors)} competitors and {len(tournament.rounds)} rounds")
    
    # Convert structure to database
    result = structure_to_db(builder, existing_league)
    
    # Print final standings
    print("\n=== Final Standings ===")
    results = tournament.calculate_results()
    
    # Sort by match points
    sorted_teams = sorted(
        results.items(), 
        key=lambda x: (x[1].match_points, x[1].game_points),
        reverse=True
    )
    
    for i, (team_id, score) in enumerate(sorted_teams, 1):
        # Find team name
        team_name = None
        for name, info in builder.metadata.teams.items():
            if info['id'] == team_id:
                team_name = name
                break
        if team_name:
            print(f"{i}. {team_name}: {score.match_points} match points, {score.game_points} game points")
    
    return result['season']


@transaction.atomic
def seed_partial_tournament(num_rounds=1, include_results=True, existing_league=None):
    """
    Create a tournament progressively with specified number of rounds.
    
    Args:
        num_rounds: Number of rounds to create
        include_results: Whether to include results or just pairings
        existing_league: Optional existing League to use
    """
    print(f"=== Seeding {num_rounds} rounds {'with results' if include_results else 'pairings only'} ===")
    
    # Create converter and parse TRF16
    converter = TRF16Converter(TRF16_DATA)
    converter.parse()
    
    # Override the league tag to use "championship" instead of "TRF16"
    converter.header.tournament_name = "Crete Championship 2025"
    
    # Create tournament builder
    builder = converter.create_tournament_builder(league_tag="championship")
    
    # Override the league tag
    builder.metadata.league_tag = "championship"
    
    # Add specified rounds
    if include_results:
        converter.add_rounds_to_builder(builder, rounds_to_add=list(range(1, num_rounds + 1)))
    else:
        # For pairings only, we'd need to modify the converter
        # For now, just add with results
        converter.add_rounds_to_builder(builder, rounds_to_add=list(range(1, num_rounds + 1)))
    
    # Convert to database
    result = structure_to_db(builder, existing_league)
    
    return result['season']


# Convenience functions
def seed_teams_only(existing_league=None):
    """Create only teams without any rounds."""
    print("=== Seeding teams only ===")
    
    # Create converter and parse TRF16
    converter = TRF16Converter(TRF16_DATA)
    converter.parse()
    
    # Override the league tag
    converter.header.tournament_name = "Crete Championship 2025"
    
    # Create tournament builder with just teams
    builder = converter.create_tournament_builder()
    
    # Override the league tag
    builder.metadata.league_tag = "championship"
    
    # Don't add any rounds
    
    # Convert to database
    result = structure_to_db(builder, existing_league)
    
    print(f"Created {len(result['teams'])} teams")
    return result['season']