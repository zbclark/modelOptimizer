// Updated before Texas Children's Open
const WEIGHT_TEMPLATES = {
  POWER: {
    name: "POWER",
    description: "Data-driven weights for distance-heavy courses (HIGH Distance correlation: 0.37)",
    groupWeights: {
      "Driving Performance": 0.13,
      "Approach - Short (<100)": 0.145,
      "Approach - Mid (100-150)": 0.18,
      "Approach - Long (150-200)": 0.15,
      "Approach - Very Long (>200)": 0.03,
      "Putting": 0.12,
      "Around the Green": 0.08,
      "Scoring": 0.11,
      "Course Management": 0.055
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.404 },
        "Driving Accuracy": { weight: 0.123 },
        "SG OTT": { weight: 0.472 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.14 },
        "Approach <100 SG": { weight: 0.33 },
        "Approach <100 Prox": { weight: 0.53 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.12 },
        "Approach <150 FW SG": { weight: 0.32 },
        "Approach <150 FW Prox": { weight: 0.56 },
        "Approach <150 Rough GIR": { weight: 0.12 },
        "Approach <150 Rough SG": { weight: 0.32 },
        "Approach <150 Rough Prox": { weight: 0.56 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.11 },
        "Approach <200 FW SG": { weight: 0.3 },
        "Approach <200 FW Prox": { weight: 0.59 },
        "Approach >150 Rough GIR": { weight: 0.11 },
        "Approach >150 Rough SG": { weight: 0.3 },
        "Approach >150 Rough Prox": { weight: 0.59 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.1 },
        "Approach >200 FW SG": { weight: 0.25 },
        "Approach >200 FW Prox": { weight: 0.65 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.2 },
        "Scoring Average": { weight: 0.1 },
        "Birdie Chances Created": { weight: 0.1 },
        "Scoring: Approach <100 SG": { weight: 0.15 },
        "Scoring: Approach <150 FW SG": { weight: 0.15 },
        "Scoring: Approach <150 Rough SG": { weight: 0.15 },
        "Scoring: Approach <200 FW SG": { weight: 0.05 },
        "Scoring: Approach >200 FW SG": { weight: 0 },
        "Scoring: Approach >150 Rough SG": { weight: 0.1 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.12 },
        "Great Shots": { weight: 0.08 },
        "Poor Shot Avoidance": { weight: 0.08 },
        "Course Management: Approach <100 Prox": { weight: 0.1 },
        "Course Management: Approach <150 FW Prox": { weight: 0.1 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.15 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.2 },
        "Course Management: Approach <200 FW Prox": { weight: 0.12 },
        "Course Management: Approach >200 FW Prox": { weight: 0.05 }
      }
    }
  },
  TECHNICAL: {
    name: "TECHNICAL",
    description: "Validation-driven TECHNICAL template (2026 season)",
    groupWeights: {
      "Driving Performance": 0.1116538864888844,
      "Approach - Short (<100)": 0.1116538864888844,
      "Approach - Mid (100-150)": 0.1116538864888844,
      "Approach - Long (150-200)": 0.11165388648888439,
      "Approach - Very Long (>200)": 0.1116538864888844,
      "Putting": 0.1116538864888844,
      "Around the Green": 0.1116538864888844,
      "Scoring": 0.1116538864888844,
      "Course Management": 0.10676890808892485
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.301183218899273 },
        "Driving Accuracy": { weight: 0.280764057729585 },
        "SG OTT": { weight: 0.4180527233711421 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.34224601957293876 },
        "Approach <100 SG": { weight: 0.2847608738264007 },
        "Approach <100 Prox": { weight: 0.37299310660066054 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.2313028300887257 },
        "Approach <150 FW SG": { weight: 0.2702933120960881 },
        "Approach <150 FW Prox": { weight: 0.10079153480335201 },
        "Approach <150 Rough GIR": { weight: 0.14595224132850498 },
        "Approach <150 Rough SG": { weight: 0.18312956976939568 },
        "Approach <150 Rough Prox": { weight: 0.06853051191393361 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.22276389503102131 },
        "Approach <200 FW SG": { weight: 0.25948228422875086 },
        "Approach <200 FW Prox": { weight: 0.10630247700730287 },
        "Approach >150 Rough GIR": { weight: 0.18234659890117172 },
        "Approach >150 Rough SG": { weight: 0.15881425458685394 },
        "Approach >150 Rough Prox": { weight: 0.07029049024489936 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.39918715260587584 },
        "Approach >200 FW SG": { weight: 0.39287092776549637 },
        "Approach >200 FW Prox": { weight: 0.2079419196286279 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.47781500879297284 },
        "Scoring Average": { weight: 0.11324451375166963 },
        "Birdie Chances Created": { weight: 0.1170807375937773 },
        "Scoring: Approach <100 SG": { weight: 0.03012944077767114 },
        "Scoring: Approach <150 FW SG": { weight: 0.068988076276715 },
        "Scoring: Approach <150 Rough SG": { weight: 0.039538993224117074 },
        "Scoring: Approach <200 FW SG": { weight: 0.05708427080235363 },
        "Scoring: Approach >200 FW SG": { weight: 0.04544485973285522 },
        "Scoring: Approach >150 Rough SG": { weight: 0.0506740990478684 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.17468276609112238 },
        "Great Shots": { weight: 0.15172555409854055 },
        "Poor Shot Avoidance": { weight: 0.08250363456418564 },
        "Course Management: Approach <100 Prox": { weight: 0.10334669291738924 },
        "Course Management: Approach <150 FW Prox": { weight: 0.14384334304938237 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.10289270829547675 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.028210053261568672 },
        "Course Management: Approach <200 FW Prox": { weight: 0.11730365864043327 },
        "Course Management: Approach >200 FW Prox": { weight: 0.09549158908190114 }
      }
    }
  },
  BALANCED: {
    name: "BALANCED",
    description: "Validation CSV BALANCED template (Weight_Templates.csv)",
    groupWeights: {
      "Driving Performance": 0.17270184528167298,
      "Approach - Short (<100)": 0.04017195096769349,
      "Approach - Mid (100-150)": 0.10493514294832086,
      "Approach - Long (150-200)": 0.11343883163447278,
      "Approach - Very Long (>200)": 0.06363687559835557,
      "Putting": 0.09158829381840027,
      "Around the Green": 0.04959546469936739,
      "Scoring": 0.2681759306189109,
      "Course Management": 0.09575566443280585
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.3861 },
        "Driving Accuracy": { weight: 0.2896 },
        "SG OTT": { weight: 0.3243 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.659065906590659 },
        "Approach <100 SG": { weight: 0.2999299929992999 },
        "Approach <100 Prox": { weight: 0.041004100410041 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.2096 },
        "Approach <150 FW SG": { weight: 0.267 },
        "Approach <150 FW Prox": { weight: 0.0442 },
        "Approach <150 Rough GIR": { weight: 0.2402 },
        "Approach <150 Rough SG": { weight: 0.2092 },
        "Approach <150 Rough Prox": { weight: 0.0298 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.282 },
        "Approach <200 FW SG": { weight: 0.2421 },
        "Approach <200 FW Prox": { weight: 0.0167 },
        "Approach >150 Rough GIR": { weight: 0.2201 },
        "Approach >150 Rough SG": { weight: 0.2287 },
        "Approach >150 Rough Prox": { weight: 0.0104 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.43420000000000003 },
        "Approach >200 FW SG": { weight: 0.35880000000000006 },
        "Approach >200 FW Prox": { weight: 0.20700000000000002 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.4203 },
        "Scoring Average": { weight: 0.1088 },
        "Birdie Chances Created": { weight: 0.1261 },
        "Scoring: Approach <100 SG": { weight: 0.0553 },
        "Scoring: Approach <150 FW SG": { weight: 0.0471 },
        "Scoring: Approach <150 Rough SG": { weight: 0.057 },
        "Scoring: Approach <200 FW SG": { weight: 0.0516 },
        "Scoring: Approach >200 FW SG": { weight: 0.0774 },
        "Scoring: Approach >150 Rough SG": { weight: 0.0564 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.22247775222477753 },
        "Great Shots": { weight: 0.16118388161183883 },
        "Poor Shot Avoidance": { weight: 0.346159378567374 },
        "Course Management: Approach <100 Prox": { weight: 0.045795420457954206 },
        "Course Management: Approach <150 FW Prox": { weight: 0.014998500149985002 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.11868813118688132 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.15668433156684333 },
        "Course Management: Approach <200 FW Prox": { weight: 0.0468953104689531 },
        "Course Management: Approach >200 FW Prox": { weight: 0.05939406059394061 }
      }
    }
  },
  TPC_LOUISIANA: {
    name: "TPC_LOUISIANA",
    eventId: "18",
    description: "Zurich Classic template from provided raw metric weights",
    groupWeights: {
      "Driving Performance": 0.09,
      "Approach - Short (<100)": 0.148,
      "Approach - Mid (100-150)": 0.19,
      "Approach - Long (150-200)": 0.16,
      "Approach - Very Long (>200)": 0.035,
      "Putting": 0.115,
      "Around the Green": 0.1,
      "Scoring": 0.105,
      "Course Management": 0.057
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.35 },
        "Driving Accuracy": { weight: 0.3 },
        "SG OTT": { weight: 0.35 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.3 },
        "Approach <100 SG": { weight: 0.4 },
        "Approach <100 Prox": { weight: 0.3 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.3 },
        "Approach <150 FW SG": { weight: 0.45 },
        "Approach <150 FW Prox": { weight: 0.25 },
        "Approach <150 Rough GIR": { weight: 0.3 },
        "Approach <150 Rough SG": { weight: 0.45 },
        "Approach <150 Rough Prox": { weight: 0.25 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.3 },
        "Approach <200 FW SG": { weight: 0.45 },
        "Approach <200 FW Prox": { weight: 0.25 },
        "Approach >150 Rough GIR": { weight: 0.3 },
        "Approach >150 Rough SG": { weight: 0.45 },
        "Approach >150 Rough Prox": { weight: 0.25 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.3 },
        "Approach >200 FW SG": { weight: 0.45 },
        "Approach >200 FW Prox": { weight: 0.25 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0 },
        "Scoring Average": { weight: 0.15 },
        "Birdie Chances Created": { weight: 0.35 },
        "Scoring: Approach <100 SG": { weight: 0.07 },
        "Scoring: Approach <150 FW SG": { weight: 0.1 },
        "Scoring: Approach <150 Rough SG": { weight: 0.08 },
        "Scoring: Approach >150 Rough SG": { weight: 0.07 },
        "Scoring: Approach <200 FW SG": { weight: 0.1 },
        "Scoring: Approach >200 FW SG": { weight: 0.08 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.25 },
        "Great Shots": { weight: 0.15 },
        "Poor Shot Avoidance": { weight: 0.2 },
        "Course Management: Approach <100 Prox": { weight: 0.07 },
        "Course Management: Approach <150 FW Prox": { weight: 0.09 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.06 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.05 },
        "Course Management: Approach <200 FW Prox": { weight: 0.08 },
        "Course Management: Approach >200 FW Prox": { weight: 0.05 }
      }
    }
  },
  PEBBLE_BEACH_GOLF_LINKS: {
    name: "PEBBLE_BEACH_GOLF_LINKS",
    eventId: "5",
    description: "Pebble Beach Pro-Am 2026 Optimized: 0.3047 corr, 50.0% Top-20, 53.4% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.10253232601257035,
      "Approach - Short (<100)": 0.1194177959871931,
      "Approach - Mid (100-150)": 0.19375312503916445,
      "Approach - Long (150-200)": 0.11283455022262502,
      "Approach - Very Long (>200)": 0.029830996955166857,
      "Putting": 0.09934284835069716,
      "Around the Green": 0.13318995424683816,
      "Scoring": 0.1521568461046561,
      "Course Management": 0.05694155708108894
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.16519314628973553 },
        "Driving Accuracy": { weight: 0.41495245725416324 },
        "SG OTT": { weight: 0.4198543964561012 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.07167125851986278 },
        "Approach <100 SG": { weight: 0.2977358675266523 },
        "Approach <100 Prox": { weight: 0.630592873953485 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.06708734747394228 },
        "Approach <150 FW SG": { weight: 0.22250121842213122 },
        "Approach <150 FW Prox": { weight: 0.44512389317756607 },
        "Approach <150 Rough GIR": { weight: 0.06405885133956395 },
        "Approach <150 Rough SG": { weight: 0.20107751449134112 },
        "Approach <150 Rough Prox": { weight: -0.00015117509545549586 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.06108743854760371 },
        "Approach <200 FW SG": { weight: 0.17985027266788273 },
        "Approach <200 FW Prox": { weight: 0.47683240996839626 },
        "Approach >150 Rough GIR": { weight: 0.06608787603574998 },
        "Approach >150 Rough SG": { weight: 0.21598692436306388 },
        "Approach >150 Rough Prox": { weight: -0.00015507841730361856 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.0675386398867802 },
        "Approach >200 FW SG": { weight: 0.25391418022988105 },
        "Approach >200 FW Prox": { weight: 0.6785471798833387 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.18450510196443498 },
        "Scoring Average": { weight: 0.19630805597599443 },
        "Birdie Chances Created": { weight: 0.04784940963206374 },
        "Scoring: Approach <100 SG": { weight: 0.05728197800506118 },
        "Scoring: Approach <150 FW SG": { weight: 0.08939371466950806 },
        "Scoring: Approach <150 Rough SG": { weight: 0.09228072687229313 },
        "Scoring: Approach <200 FW SG": { weight: 0.1856757452158533 },
        "Scoring: Approach >200 FW SG": { weight: 0.07140720714703559 },
        "Scoring: Approach >150 Rough SG": { weight: 0.07529806051775546 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.4243083111011691 },
        "Great Shots": { weight: 0.16867554116207167 },
        "Poor Shot Avoidance": { weight: -0.07794848211446015 },
        "Course Management: Approach <100 Prox": { weight: 0.04525146102788264 },
        "Course Management: Approach <150 FW Prox": { weight: 0.07549007658011239 },
        "Course Management: Approach <150 Rough Prox": { weight: -0.00010419015793454041 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.00010419015793454041 },
        "Course Management: Approach <200 FW Prox": { weight: 0.13943513462551332 },
        "Course Management: Approach >200 FW Prox": { weight: 0.07028763515918848 }
      }
    }
  },
  WAIALAE_COUNTRY_CLUB: {
    name: "WAIALAE_COUNTRY_CLUB",
    eventId: "6",
    description: "Sony Open 2026 Optimized: 0.4896 corr, 6.4% Top-20, 7.3% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.14221547712535823,
      "Approach - Short (<100)": 0.14223367573656825,
      "Approach - Mid (100-150)": 0.1585070053307613,
      "Approach - Long (150-200)": 0.1471382852447258,
      "Approach - Very Long (>200)": 0.02942765704894516,
      "Putting": 0.14015203361392248,
      "Around the Green": 0.07847375213052042,
      "Scoring": 0.10790140917946558,
      "Course Management": 0.05395070458973279
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.4439213937297278 },
        "Driving Accuracy": { weight: 0.10452536855202589 },
        "SG OTT": { weight: 0.45155323771824624 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.12704935482846694 },
        "Approach <100 SG": { weight: 0.3439453170521983 },
        "Approach <100 Prox": { weight: -0.5290053281193348 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.061009317754322216 },
        "Approach <150 FW SG": { weight: 0.1647364944519474 },
        "Approach <150 FW Prox": { weight: -0.3032646295934103 },
        "Approach <150 Rough GIR": { weight: 0.06366492684648313 },
        "Approach <150 Rough SG": { weight: 0.15126210442130167 },
        "Approach <150 Rough Prox": { weight: -0.25606252693253534 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.058875045115195625 },
        "Approach <200 FW SG": { weight: 0.15107854596009665 },
        "Approach <200 FW Prox": { weight: -0.29321927092225336 },
        "Approach >150 Rough GIR": { weight: 0.053690945491580384 },
        "Approach >150 Rough SG": { weight: 0.1428106531715783 },
        "Approach >150 Rough Prox": { weight: -0.30032553933929573 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.08980228691878112 },
        "Approach >200 FW SG": { weight: 0.2624094451995176 },
        "Approach >200 FW Prox": { weight: -0.6477882678817013 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.1947674504535388 },
        "Scoring Average": { weight: -0.09468975965994297 },
        "Birdie Chances Created": { weight: 0.09881839144013035 },
        "Scoring: Approach <100 SG": { weight: 0.16398981034606624 },
        "Scoring: Approach <150 FW SG": { weight: 0.14839301873369026 },
        "Scoring: Approach <150 Rough SG": { weight: 0.14399947925214288 },
        "Scoring: Approach <200 FW SG": { weight: 0.05187189593106295 },
        "Scoring: Approach >200 FW SG": { weight: 0.0000955570911835887 },
        "Scoring: Approach >150 Rough SG": { weight: 0.10337463709224189 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.11502369101039253 },
        "Great Shots": { weight: 0.09022106664922576 },
        "Poor Shot Avoidance": { weight: -0.07429961681411379 },
        "Course Management: Approach <100 Prox": { weight: -0.10783374148021413 },
        "Course Management: Approach <150 FW Prox": { weight: -0.10556394634166712 },
        "Course Management: Approach <150 Rough Prox": { weight: -0.16433815048123793 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.17586640960416564 },
        "Course Management: Approach <200 FW Prox": { weight: -0.12204491100887761 },
        "Course Management: Approach >200 FW Prox": { weight: -0.044808466610105416 }
      }
    }
  },
  THE_RIVIERA_COUNTRY_CLUB: {
    name: "THE_RIVIERA_COUNTRY_CLUB",
    eventId: "7",
    description: "Genesis Invitational 2026 Optimized: 0.6418 corr, 65.0% Top-20, 72.4% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.14491401069595441,
      "Approach - Short (<100)": 0.14493255462515853,
      "Approach - Mid (100-150)": 0.14126346877427762,
      "Approach - Long (150-200)": 0.12318067661640782,
      "Approach - Very Long (>200)": 0.02998604578451556,
      "Putting": 0.17083720293014232,
      "Around the Green": 0.07996278875870816,
      "Scoring": 0.10994883454322371,
      "Course Management": 0.054974417271611856
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.5121256291951152 },
        "Driving Accuracy": { weight: 0.09293882047578655 },
        "SG OTT": { weight: 0.39493555032909816 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.2625572329653397 },
        "Approach <100 SG": { weight: 0.7372450888294415 },
        "Approach <100 Prox": { weight: 0.00019767820521883359 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.15936071336747104 },
        "Approach <150 FW SG": { weight: 0.3593671285754248 },
        "Approach <150 FW Prox": { weight: 0.00023697051816604892 },
        "Approach <150 Rough GIR": { weight: 0.15789928742890777 },
        "Approach <150 Rough SG": { weight: 0.3228989295918644 },
        "Approach <150 Rough Prox": { weight: 0.00023697051816604892 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.13142478679999592 },
        "Approach <200 FW SG": { weight: 0.388725559496779 },
        "Approach <200 FW Prox": { weight: 0.0002563771341928853 },
        "Approach >150 Rough GIR": { weight: 0.13380444612429132 },
        "Approach >150 Rough SG": { weight: 0.345532453310548 },
        "Approach >150 Rough Prox": { weight: -0.0002563771341928853 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.2197010793735438 },
        "Approach >200 FW SG": { weight: 0.7800361356526654 },
        "Approach >200 FW Prox": { weight: 0.0002627849737908229 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.23074569266537626 },
        "Scoring Average": { weight: 0.00010824312848986641 },
        "Birdie Chances Created": { weight: 0.0933274578156979 },
        "Scoring: Approach <100 SG": { weight: 0.17643055860134577 },
        "Scoring: Approach <150 FW SG": { weight: 0.1695485759178827 },
        "Scoring: Approach <150 Rough SG": { weight: 0.1537034966494277 },
        "Scoring: Approach <200 FW SG": { weight: 0.0614716273448912 },
        "Scoring: Approach >200 FW SG": { weight: 0.00010824312848986641 },
        "Scoring: Approach >150 Rough SG": { weight: 0.11455610474839885 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.3663343336024537 },
        "Great Shots": { weight: 0.3100090948394791 },
        "Poor Shot Avoidance": { weight: 0.2471999056539836 },
        "Course Management: Approach <100 Prox": { weight: 0.0003595081816616878 },
        "Course Management: Approach <150 FW Prox": { weight: 0.0003595081816616878 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.0003595081816616878 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.0003595081816616878 },
        "Course Management: Approach <200 FW Prox": { weight: 0.0003595081816616878 },
        "Course Management: Approach >200 FW Prox": { weight: 0.0003595081816616878 }
      }
    }
  },
  PETE_DYE_STADIUM_COURSE: {
    name: "PETE_DYE_STADIUM_COURSE",
    eventId: "2",
    description: "American Express 2026 Optimized: 0.8272 corr, 60.0% Top-20, 70.8% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.1253131911339183,
      "Approach - Short (<100)": 0.038061908773678634,
      "Approach - Mid (100-150)": 0.09232390111204239,
      "Approach - Long (150-200)": 0.09713943483724766,
      "Approach - Very Long (>200)": 0.052687619599157735,
      "Putting": 0.10884765419724342,
      "Around the Green": 0.04678045227166973,
      "Scoring": 0.23772324926223903,
      "Course Management": 0.2011225888128031
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.27923808554329926 },
        "Driving Accuracy": { weight: 0.2936802262057306 },
        "SG OTT": { weight: 0.4270816882509701 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.1284642840040011 },
        "Approach <100 SG": { weight: 0.08207670615053442 },
        "Approach <100 Prox": { weight: -0.7894590098454645 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.1262684554688367 },
        "Approach <150 FW SG": { weight: 0.19181023674027556 },
        "Approach <150 FW Prox": { weight: 0.681604078651498 },
        "Approach <150 Rough GIR": { weight: 0.00010574304646325831 },
        "Approach <150 Rough SG": { weight: 0.00010574304646325831 },
        "Approach <150 Rough Prox": { weight: -0.00010574304646325831 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.11720580542183769 },
        "Approach <200 FW SG": { weight: 0.35405375523227467 },
        "Approach <200 FW Prox": { weight: 0.5284130271688414 },
        "Approach >150 Rough GIR": { weight: 0.00010913739234877063 },
        "Approach >150 Rough SG": { weight: 0.00010913739234877063 },
        "Approach >150 Rough Prox": { weight: -0.00010913739234877063 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.11296129416014204 },
        "Approach >200 FW SG": { weight: 0.17517432657899157 },
        "Approach >200 FW Prox": { weight: -0.7118643792608664 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.7655709758222491 },
        "Scoring Average": { weight: 0.007996325976291628 },
        "Birdie Chances Created": { weight: 0.09163537167074406 },
        "Scoring: Approach <100 SG": { weight: 0.008842514217185474 },
        "Scoring: Approach <150 FW SG": { weight: 0.017359903870478935 },
        "Scoring: Approach <150 Rough SG": { weight: 0.021512179838451863 },
        "Scoring: Approach <200 FW SG": { weight: 0.05542564628140196 },
        "Scoring: Approach >200 FW SG": { weight: 0.014360125375776923 },
        "Scoring: Approach >150 Rough SG": { weight: 0.017296956947420127 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.3738648846703404 },
        "Great Shots": { weight: 0.08278006608084369 },
        "Poor Shot Avoidance": { weight: 0.20992705977835463 },
        "Course Management: Approach <100 Prox": { weight: -0.030212644831939545 },
        "Course Management: Approach <150 FW Prox": { weight: 0.0699386316246899 },
        "Course Management: Approach <150 Rough Prox": { weight: -0.07517216176760337 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.05296510860702875 },
        "Course Management: Approach <200 FW Prox": { weight: 0.18280075040093738 },
        "Course Management: Approach >200 FW Prox": { weight: -0.05795170447265951 }
      }
    }
  },
  TORREY_PINES_GOLF_COURSE: {
    name: "TORREY_PINES_GOLF_COURSE",
    eventId: "4",
    description: "Farmers 2026 Optimized: 0.8968 corr, 85.0% Top-20, 91.2% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.12660970239530023,
      "Approach - Short (<100)": 0.03845570365599098,
      "Approach - Mid (100-150)": 0.09327909965421785,
      "Approach - Long (150-200)": 0.08069236890192115,
      "Approach - Very Long (>200)": 0.05323273453500447,
      "Putting": 0.12956308680702602,
      "Around the Green": 0.04726445066508662,
      "Scoring": 0.24018277381006914,
      "Course Management": 0.1907200795753835
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.31176799346270223 },
        "Driving Accuracy": { weight: 0.31964555231972197 },
        "SG OTT": { weight: 0.3685864542175758 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.6036962474169806 },
        "Approach <100 SG": { weight: 0.39585520976128485 },
        "Approach <100 Prox": { weight: 0.0004485428217345848 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.10705782084139466 },
        "Approach <150 FW SG": { weight: 0.1971588253591168 },
        "Approach <150 FW Prox": { weight: 0.6954900830682796 },
        "Approach <150 Rough GIR": { weight: 0.00009867208712271649 },
        "Approach <150 Rough SG": { weight: 0.00009729932204305113 },
        "Approach <150 Rough Prox": { weight: -0.00009729932204305113 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.12213861844559162 },
        "Approach <200 FW SG": { weight: 0.35239036142743935 },
        "Approach <200 FW Prox": { weight: 0.5251616090847234 },
        "Approach >150 Rough GIR": { weight: 0.00009842786400276938 },
        "Approach >150 Rough SG": { weight: 0.00011255531424005993 },
        "Approach >150 Rough Prox": { weight: -0.00009842786400276938 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.3349991560344384 },
        "Approach >200 FW SG": { weight: 0.6646593942961323 },
        "Approach >200 FW Prox": { weight: 0.00034144966942937724 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.7826623799724027 },
        "Scoring Average": { weight: 0.007818311232344936 },
        "Birdie Chances Created": { weight: 0.07900675571673915 },
        "Scoring: Approach <100 SG": { weight: 0.007389830518636098 },
        "Scoring: Approach <150 FW SG": { weight: 0.016113217969961735 },
        "Scoring: Approach <150 Rough SG": { weight: 0.019173022165490886 },
        "Scoring: Approach <200 FW SG": { weight: 0.05867670947350347 },
        "Scoring: Approach >200 FW SG": { weight: 0.014092796345894009 },
        "Scoring: Approach >150 Rough SG": { weight: 0.015066976605027012 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.4798787771341577 },
        "Great Shots": { weight: 0.10726773827572121 },
        "Poor Shot Avoidance": { weight: 0.10158100809932528 },
        "Course Management: Approach <100 Prox": { weight: 0.00012381627567870942 },
        "Course Management: Approach <150 FW Prox": { weight: 0.08407240502916724 },
        "Course Management: Approach <150 Rough Prox": { weight: -0.00012381627567870942 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.00012381627567870942 },
        "Course Management: Approach <200 FW Prox": { weight: 0.21993976277920974 },
        "Course Management: Approach >200 FW Prox": { weight: 0.00012381627567870942 }
      }
    }
  },
  WM_PHOENIX_OPEN_STADIUM_COURSE: {
    name: "WM_PHOENIX_OPEN_STADIUM_COURSE",
    eventId: "3",
    description: "WM Phoenix Open 2026 Pre-Event Blended",
    groupWeights: {
      "Driving Performance": 0.1474470012193952,
      "Approach - Short (<100)": 0.06544188790997547,
      "Approach - Mid (100-150)": 0.10806403205559553,
      "Approach - Long (150-200)": 0.12602883074039747,
      "Approach - Very Long (>200)": 0.03686884295420168,
      "Putting": 0.08993059763355224,
      "Around the Green": 0.05106015640756827,
      "Scoring": 0.208609249018739,
      "Course Management": 0.16654940206057514
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.2791439082556341 },
        "Driving Accuracy": { weight: 0.279165053917666 },
        "SG OTT": { weight: 0.4416910378267 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.4424213578642136 },
        "Approach <100 SG": { weight: 0.30442275772422756 },
        "Approach <100 Prox": { weight: 0.25315588441155884 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.14216793107882214 },
        "Approach <150 FW SG": { weight: 0.1626214049976426 },
        "Approach <150 FW Prox": { weight: 0.1777874930350178 },
        "Approach <150 Rough GIR": { weight: 0.13985341391281986 },
        "Approach <150 Rough SG": { weight: 0.17363679225065362 },
        "Approach <150 Rough Prox": { weight: 0.2039329647250439 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.1354857142857143 },
        "Approach <200 FW SG": { weight: 0.15694285714285716 },
        "Approach <200 FW Prox": { weight: 0.20110000000000003 },
        "Approach >150 Rough GIR": { weight: 0.12057142857142858 },
        "Approach >150 Rough SG": { weight: 0.14507142857142857 },
        "Approach >150 Rough Prox": { weight: 0.24082857142857145 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.15443144314431445 },
        "Approach >200 FW SG": { weight: 0.265016501650165 },
        "Approach >200 FW Prox": { weight: 0.5805520552055206 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.5088361433217414 },
        "Scoring Average": { weight: 0.18642385667825864 },
        "Birdie Chances Created": { weight: 0.08676000000000002 },
        "Scoring: Approach <100 SG": { weight: 0.0163485 },
        "Scoring: Approach <150 FW SG": { weight: 0.030081240000000002 },
        "Scoring: Approach <150 Rough SG": { weight: 0.030081240000000002 },
        "Scoring: Approach <200 FW SG": { weight: 0.08828190000000001 },
        "Scoring: Approach >200 FW SG": { weight: 0.02659356 },
        "Scoring: Approach >150 Rough SG": { weight: 0.02659356 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.32567601153451076 },
        "Great Shots": { weight: 0.15977217208123562 },
        "Poor Shot Avoidance": { weight: 0.16935123721723203 },
        "Course Management: Approach <100 Prox": { weight: 0.025890043437526614 },
        "Course Management: Approach <150 FW Prox": { weight: 0.04763767992504897 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.04763767992504897 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.042114470658376625 },
        "Course Management: Approach <200 FW Prox": { weight: 0.1398062345626437 },
        "Course Management: Approach >200 FW Prox": { weight: 0.042114470658376625 }
      }
    }
  },
  PGA_NATIONAL_RESORT_CHAMPION_COURSE: {
    name: "PGA_NATIONAL_RESORT_CHAMPION_COURSE",
    eventId: "10",
    description: "Cognizant Classic 2026 Optimized: 0.8115 corr, 75.0% Top-20, 86.9% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.139802052317936,
      "Approach - Short (<100)": 0.049918385728951215,
      "Approach - Mid (100-150)": 0.08991844405246115,
      "Approach - Long (150-200)": 0.0986426313577991,
      "Approach - Very Long (>200)": 0.04744792357376038,
      "Putting": 0.10529817341347819,
      "Around the Green": 0.057047022911825625,
      "Scoring": 0.28031335441631916,
      "Course Management": 0.13161201222746913
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.2546693201661473 },
        "Driving Accuracy": { weight: 0.3141084710185391 },
        "SG OTT": { weight: 0.43122220881531365 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.48478342010029074 },
        "Approach <100 SG": { weight: 0.37274890023325546 },
        "Approach <100 Prox": { weight: 0.14246767966645388 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.21698109323871806 },
        "Approach <150 FW SG": { weight: 0.22862655302551652 },
        "Approach <150 FW Prox": { weight: -0.08156809146509487 },
        "Approach <150 Rough GIR": { weight: 0.19903906749446293 },
        "Approach <150 Rough SG": { weight: 0.22258991546252752 },
        "Approach <150 Rough Prox": { weight: 0.05119527931367997 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.23459723275824657 },
        "Approach <200 FW SG": { weight: 0.25127625548690646 },
        "Approach <200 FW Prox": { weight: -0.076603970702823 },
        "Approach >150 Rough GIR": { weight: 0.16345331085501544 },
        "Approach >150 Rough SG": { weight: 0.22483869300652576 },
        "Approach >150 Rough Prox": { weight: 0.04923053719048285 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.3351304210719545 },
        "Approach >200 FW SG": { weight: 0.3424222367613377 },
        "Approach >200 FW Prox": { weight: -0.3224473421667078 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.46243473880899155 },
        "Scoring Average": { weight: 0.23952042731697154 },
        "Birdie Chances Created": { weight: 0.06842390917614805 },
        "Scoring: Approach <100 SG": { weight: 0.0187758136848655 },
        "Scoring: Approach <150 FW SG": { weight: 0.025417071593118186 },
        "Scoring: Approach <150 Rough SG": { weight: 0.02269323235714167 },
        "Scoring: Approach <200 FW SG": { weight: 0.08412058325487454 },
        "Scoring: Approach >200 FW SG": { weight: 0.04156885316218043 },
        "Scoring: Approach >150 Rough SG": { weight: 0.037045370645708564 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.4469271053234971 },
        "Great Shots": { weight: 0.21494389530715677 },
        "Poor Shot Avoidance": { weight: 0.17510774960570225 },
        "Course Management: Approach <100 Prox": { weight: 0.026122754506963237 },
        "Course Management: Approach <150 FW Prox": { weight: -0.028352350116483484 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.03556245158620629 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.050093183646499874 },
        "Course Management: Approach <200 FW Prox": { weight: -0.13895724110515392 },
        "Course Management: Approach >200 FW Prox": { weight: -0.05892186579845889 }
      }
    }
  },
  TPC_SAWGRASS: {
    name: "TPC_SAWGRASS",
    eventId: "11",
    description: "The PLAYERS 2026 Optimized: 0.8113 corr, 80.0% Top-20, 81.6% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.17477218530763167,
      "Approach - Short (<100)": 0.039362386952662545,
      "Approach - Mid (100-150)": 0.10047767195811229,
      "Approach - Long (150-200)": 0.10872900819667929,
      "Approach - Very Long (>200)": 0.0670116749538243,
      "Putting": 0.08137018128756883,
      "Around the Green": 0.04715518339794675,
      "Scoring": 0.29049260082015255,
      "Course Management": 0.09062910712542181
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.31407758535019403 },
        "Driving Accuracy": { weight: 0.27588045711492853 },
        "SG OTT": { weight: 0.4100419575348774 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.5273141495333916 },
        "Approach <100 SG": { weight: 0.33580245535560505 },
        "Approach <100 Prox": { weight: 0.13688339511100336 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.17777137892355482 },
        "Approach <150 FW SG": { weight: 0.2698349751256276 },
        "Approach <150 FW Prox": { weight: 0.11174221032553663 },
        "Approach <150 Rough GIR": { weight: 0.1962893762858742 },
        "Approach <150 Rough SG": { weight: 0.19166182184430794 },
        "Approach <150 Rough Prox": { weight: 0.05270023749509873 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.21171271044314205 },
        "Approach <200 FW SG": { weight: 0.2403795774364927 },
        "Approach <200 FW Prox": { weight: 0.08234551409379164 },
        "Approach >150 Rough GIR": { weight: 0.2078726051594615 },
        "Approach >150 Rough SG": { weight: 0.20172171578527204 },
        "Approach >150 Rough Prox": { weight: 0.055967877081839985 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.3271395284421379 },
        "Approach >200 FW SG": { weight: 0.41171143654054226 },
        "Approach >200 FW Prox": { weight: 0.26114903501731984 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.40206728657391816 },
        "Scoring Average": { weight: 0.12913699221805178 },
        "Birdie Chances Created": { weight: 0.12029187739529434 },
        "Scoring: Approach <100 SG": { weight: 0.05376269909456871 },
        "Scoring: Approach <150 FW SG": { weight: 0.05892206821382206 },
        "Scoring: Approach <150 Rough SG": { weight: 0.06511678685379985 },
        "Scoring: Approach <200 FW SG": { weight: 0.06487039554022006 },
        "Scoring: Approach >200 FW SG": { weight: 0.05292400090330502 },
        "Scoring: Approach >150 Rough SG": { weight: 0.05290789320702003 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.30425053183367756 },
        "Great Shots": { weight: 0.17107371666670015 },
        "Poor Shot Avoidance": { weight: 0.2567378987496046 },
        "Course Management: Approach <100 Prox": { weight: 0.051552943754624686 },
        "Course Management: Approach <150 FW Prox": { weight: 0.05290883281556747 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.0851505213120735 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.07749714687010513 },
        "Course Management: Approach <200 FW Prox": { weight: 0.0781728048710613 },
        "Course Management: Approach >200 FW Prox": { weight: 0.05035190142579768 }
      }
    }
  },
  INNISBROOK_COPPERHEAD: {
    name: "INNISBROOK_COPPERHEAD",
    eventId: "475",
    description: "The Valspar 2026 Optimized: 0.7278 corr, 70.0% Top-20, 75.7% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.12904457092749674,
      "Approach - Short (<100)": 0.14393432911143866,
      "Approach - Mid (100-150)": 0.14707685045263885,
      "Approach - Long (150-200)": 0.1488975818394193,
      "Approach - Very Long (>200)": 0.02977951636788386,
      "Putting": 0.1423241261634206,
      "Around the Green": 0.09515568511434058,
      "Scoring": 0.10919156001557416,
      "Course Management": 0.05459578000778708
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.40755988023952094 },
        "Driving Accuracy": { weight: 0.25011515430677106 },
        "SG OTT": { weight: 0.34232496545370794 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.6031109165085986 },
        "Approach <100 SG": { weight: 0.34060483255774615 },
        "Approach <100 Prox": { weight: 0.05628425093365526 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.2021215043394407 },
        "Approach <150 FW SG": { weight: 0.25747348119575697 },
        "Approach <150 FW Prox": { weight: 0.06393442622950819 },
        "Approach <150 Rough GIR": { weight: 0.23162970106075215 },
        "Approach <150 Rough SG": { weight: 0.20173577627772418 },
        "Approach <150 Rough Prox": { weight: 0.04310511089681774 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.27822998372058605 },
        "Approach <200 FW SG": { weight: 0.238863400917567 },
        "Approach <200 FW Prox": { weight: 0.024715110256030782 },
        "Approach >150 Rough GIR": { weight: 0.2171575156627695 },
        "Approach >150 Rough SG": { weight: 0.2256425435350994 },
        "Approach >150 Rough Prox": { weight: 0.015391445907947313 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.3934753058450385 },
        "Approach >200 FW SG": { weight: 0.3251472587222474 },
        "Approach >200 FW Prox": { weight: 0.28137743543271404 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.3988587812520101 },
        "Scoring Average": { weight: 0.10878162763031074 },
        "Birdie Chances Created": { weight: 0.10637077709758315 },
        "Scoring: Approach <100 SG": { weight: 0.06997189500590423 },
        "Scoring: Approach <150 FW SG": { weight: 0.05959631563794012 },
        "Scoring: Approach <150 Rough SG": { weight: 0.07212292975292117 },
        "Scoring: Approach <200 FW SG": { weight: 0.04764370145990103 },
        "Scoring: Approach >200 FW SG": { weight: 0.06529023114474969 },
        "Scoring: Approach >150 Rough SG": { weight: 0.07136374101867989 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.18529890184383058 },
        "Great Shots": { weight: 0.1342480133807887 },
        "Poor Shot Avoidance": { weight: 0.22482462485681853 },
        "Course Management: Approach <100 Prox": { weight: 0.057213638456949024 },
        "Course Management: Approach <150 FW Prox": { weight: 0.018738091197690727 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.14828076167772594 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.19575059271187584 },
        "Course Management: Approach <200 FW Prox": { weight: 0.058587765144779674 },
        "Course Management: Approach >200 FW Prox": { weight: 0.057057610729540985 }
      }
    }
  },
  MEMORIAL_PARK_GOLF_COURSE: {
    name: "MEMORIAL_PARK_GOLF_COURSE",
    eventId: "20",
    description: "Texas Children's Open 2026 Pre-Event Blended",
    groupWeights: {
      "Driving Performance": 0.11321091240631681,
      "Approach - Short (<100)": 0.046655819188521123,
      "Approach - Mid (100-150)": 0.12810668587890647,
      "Approach - Long (150-200)": 0.1568191630779824,
      "Approach - Very Long (>200)": 0.11841833185459001,
      "Putting": 0.1275785171554636,
      "Around the Green": 0.09068701968055141,
      "Scoring": 0.12447130051174582,
      "Course Management": 0.09405225024592243
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.2772819620455204 },
        "Driving Accuracy": { weight: 0.18136814623692743 },
        "SG OTT": { weight: 0.5413498917175522 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.48400000000000004 },
        "Approach <100 SG": { weight: 0.198 },
        "Approach <100 Prox": { weight: -0.318 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.06 },
        "Approach <150 FW SG": { weight: 0.16 },
        "Approach <150 FW Prox": { weight: -0.28 },
        "Approach <150 Rough GIR": { weight: 0.06 },
        "Approach <150 Rough SG": { weight: 0.16 },
        "Approach <150 Rough Prox": { weight: 0.28 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.05500000000000001 },
        "Approach <200 FW SG": { weight: 0.15 },
        "Approach <200 FW Prox": { weight: -0.295 },
        "Approach >150 Rough GIR": { weight: 0.05500000000000001 },
        "Approach >150 Rough SG": { weight: 0.15 },
        "Approach >150 Rough Prox": { weight: 0.295 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.1 },
        "Approach >200 FW SG": { weight: 0.25 },
        "Approach >200 FW Prox": { weight: -0.65 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.4594279594487234 },
        "Scoring Average": { weight: 0.12057204055127674 },
        "Birdie Chances Created": { weight: 0.06000000000000001 },
        "Scoring: Approach <100 SG": { weight: 0.020880000000000003 },
        "Scoring: Approach <150 FW SG": { weight: 0.04896000000000001 },
        "Scoring: Approach <150 Rough SG": { weight: 0.04896000000000001 },
        "Scoring: Approach <200 FW SG": { weight: 0.13140000000000002 },
        "Scoring: Approach >200 FW SG": { weight: 0.054900000000000004 },
        "Scoring: Approach >150 Rough SG": { weight: 0.054900000000000004 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.21550862226709777 },
        "Great Shots": { weight: 0.15457547807275113 },
        "Poor Shot Avoidance": { weight: 0.17613438705510903 },
        "Course Management: Approach <100 Prox": { weight: -0.026319327731092437 },
        "Course Management: Approach <150 FW Prox": { weight: -0.06171428571428572 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.06171428571428572 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.06920168067226891 },
        "Course Management: Approach <200 FW Prox": { weight: -0.16563025210084034 },
        "Course Management: Approach >200 FW Prox": { weight: -0.06920168067226891 }
      }
    }
  }
};

module.exports = { WEIGHT_TEMPLATES };