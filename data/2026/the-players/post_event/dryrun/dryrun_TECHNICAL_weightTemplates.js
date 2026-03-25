const WEIGHT_TEMPLATES = {
  "POWER": {
    "name": "POWER",
    "description": "Data-driven weights for distance-heavy courses (HIGH Distance correlation: 0.37)",
    "groupWeights": {
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
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.404
        },
        "Driving Accuracy": {
          "weight": 0.123
        },
        "SG OTT": {
          "weight": 0.472
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.14
        },
        "Approach <100 SG": {
          "weight": 0.33
        },
        "Approach <100 Prox": {
          "weight": 0.53
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.12
        },
        "Approach <150 FW SG": {
          "weight": 0.32
        },
        "Approach <150 FW Prox": {
          "weight": 0.56
        },
        "Approach <150 Rough GIR": {
          "weight": 0.12
        },
        "Approach <150 Rough SG": {
          "weight": 0.32
        },
        "Approach <150 Rough Prox": {
          "weight": 0.56
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.11
        },
        "Approach <200 FW SG": {
          "weight": 0.3
        },
        "Approach <200 FW Prox": {
          "weight": 0.59
        },
        "Approach >150 Rough GIR": {
          "weight": 0.11
        },
        "Approach >150 Rough SG": {
          "weight": 0.3
        },
        "Approach >150 Rough Prox": {
          "weight": 0.59
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.1
        },
        "Approach >200 FW SG": {
          "weight": 0.25
        },
        "Approach >200 FW Prox": {
          "weight": 0.65
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.2
        },
        "Scoring Average": {
          "weight": 0.1
        },
        "Birdie Chances Created": {
          "weight": 0.1
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.15
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.15
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.15
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.05
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.1
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.12
        },
        "Great Shots": {
          "weight": 0.08
        },
        "Poor Shot Avoidance": {
          "weight": 0.08
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.1
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.1
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.15
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.2
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.12
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.05
        }
      }
    }
  },
  "TECHNICAL": {
    name: "TECHNICAL",
    description: "Validation CSV TECHNICAL template (Weight_Templates.csv)",
    groupWeights: {
      "Driving Performance": 0.17622200083555614,
      "Approach - Short (<100)": 0.03968891602660925,
      "Approach - Mid (100-150)": 0.10131118038371308,
      "Approach - Long (150-200)": 0.13071632869492558,
      "Approach - Very Long (>200)": 0.06756756756756757,
      "Putting": 0.08204518430439954,
      "Around the Green": 0.04754635729665456,
      "Scoring": 0.26352154770704117,
      "Course Management": 0.09138091718353311
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.3434 },
        "Driving Accuracy": { weight: 0.2693 },
        "SG OTT": { weight: 0.3873 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.5311 },
        "Approach <100 SG": { weight: 0.3322 },
        "Approach <100 Prox": { weight: 0.1367 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.19089999999999993 },
        "Approach <150 FW SG": { weight: 0.25939999999999996 },
        "Approach <150 FW Prox": { weight: 0.10549999999999997 },
        "Approach <150 Rough GIR": { weight: 0.18929999999999994 },
        "Approach <150 Rough SG": { weight: 0.20429999999999995 },
        "Approach <150 Rough Prox": { weight: 0.050599999999999985 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.2183218321832183 },
        "Approach <200 FW SG": { weight: 0.2543254325432543 },
        "Approach <200 FW Prox": { weight: 0.0998099809980998 },
        "Approach >150 Rough GIR": { weight: 0.1889188918891889 },
        "Approach >150 Rough SG": { weight: 0.1841184118411841 },
        "Approach >150 Rough Prox": { weight: 0.0545054505450545 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.3639 },
        "Approach >200 FW SG": { weight: 0.3682 },
        "Approach >200 FW Prox": { weight: 0.2679 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.4099590040995899 },
        "Scoring Average": { weight: 0.1271872812718728 },
        "Birdie Chances Created": { weight: 0.11808819118088189 },
        "Scoring: Approach <100 SG": { weight: 0.0550944905509449 },
        "Scoring: Approach <150 FW SG": { weight: 0.06579342065793418 },
        "Scoring: Approach <150 Rough SG": { weight: 0.055294470552944695 },
        "Scoring: Approach <200 FW SG": { weight: 0.05699430056994299 },
        "Scoring: Approach >200 FW SG": { weight: 0.059094090590940895 },
        "Scoring: Approach >150 Rough SG": { weight: 0.052494750524947495 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.27248013383521535 },
        "Great Shots": { weight: 0.18893768297783353 },
        "Poor Shot Avoidance": { weight: 0.26247254254848024 },
        "Course Management: Approach <100 Prox": { weight: 0.05227938101212882 },
        "Course Management: Approach <150 FW Prox": { weight: 0.054788791300711 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.09933082392304475 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.08343789209535758 },
        "Course Management: Approach <200 FW Prox": { weight: 0.06974069427017983 },
        "Course Management: Approach >200 FW Prox": { weight: 0.044228356336260974 }
      }
    }
  },
  "BALANCED": {
    "name": "BALANCED",
    "description": "Data-driven weights for balanced courses (Accuracy: 0.35, SG Approach: 0.56)",
    "groupWeights": {},
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0
        },
        "Driving Accuracy": {
          "weight": 0
        },
        "SG OTT": {
          "weight": 0
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0
        },
        "Approach <100 SG": {
          "weight": 0
        },
        "Approach <100 Prox": {
          "weight": 0
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0
        },
        "Approach <150 FW SG": {
          "weight": 0
        },
        "Approach <150 FW Prox": {
          "weight": 0
        },
        "Approach <150 Rough GIR": {
          "weight": 0
        },
        "Approach <150 Rough SG": {
          "weight": 0
        },
        "Approach <150 Rough Prox": {
          "weight": 0
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0
        },
        "Approach <200 FW SG": {
          "weight": 0
        },
        "Approach <200 FW Prox": {
          "weight": 0
        },
        "Approach >150 Rough GIR": {
          "weight": 0
        },
        "Approach >150 Rough SG": {
          "weight": 0
        },
        "Approach >150 Rough Prox": {
          "weight": 0
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0
        },
        "Approach >200 FW SG": {
          "weight": 0
        },
        "Approach >200 FW Prox": {
          "weight": 0
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 0
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 0
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0
        },
        "Scoring Average": {
          "weight": 0
        },
        "Birdie Chances Created": {
          "weight": 0
        },
        "Scoring: Approach <100 SG": {
          "weight": 0
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0
        },
        "Great Shots": {
          "weight": 0
        },
        "Poor Shot Avoidance": {
          "weight": 0
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0
        }
      }
    }
  },
  "TPC_SAWGRASS": {
    "name": "TPC_SAWGRASS",
    "eventId": "11",
    "description": "THE PLAYERS 2026 Pre-Event Blended",
    "groupWeights": {
      "Driving Performance": 0.09296933183660619,
      "Approach - Short (<100)": 0.09568112430456222,
      "Approach - Mid (100-150)": 0.11535062552152402,
      "Approach - Long (150-200)": 0.10531255406703159,
      "Approach - Very Long (>200)": 0.05840265869870227,
      "Putting": 0.11401673535959703,
      "Around the Green": 0.06873541631676083,
      "Scoring": 0.19581640346433915,
      "Course Management": 0.15371515043087663
    },
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.242375216920852
        },
        "Driving Accuracy": {
          "weight": 0.26105185761028193
        },
        "SG OTT": {
          "weight": 0.4965729254688661
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.3730040177268823
        },
        "Approach <100 SG": {
          "weight": 0.3049009072621895
        },
        "Approach <100 Prox": {
          "weight": 0.3220950750109282
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.10087694220755003
        },
        "Approach <150 FW SG": {
          "weight": 0.18033420266781605
        },
        "Approach <150 FW Prox": {
          "weight": 0.23219339167843334
        },
        "Approach <150 Rough GIR": {
          "weight": 0.11386879849006694
        },
        "Approach <150 Rough SG": {
          "weight": 0.17125551530639313
        },
        "Approach <150 Rough Prox": {
          "weight": 0.20147114964974064
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.12244115939388665
        },
        "Approach <200 FW SG": {
          "weight": 0.18528654427286215
        },
        "Approach <200 FW Prox": {
          "weight": 0.227896284536616
        },
        "Approach >150 Rough GIR": {
          "weight": 0.10631165192480362
        },
        "Approach >150 Rough SG": {
          "weight": 0.1565828369752312
        },
        "Approach >150 Rough Prox": {
          "weight": 0.20148152289660032
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.2420394232794304
        },
        "Approach >200 FW SG": {
          "weight": 0.30495714936800133
        },
        "Approach >200 FW Prox": {
          "weight": 0.45300342735256827
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.5835732349287183
        },
        "Scoring Average": {
          "weight": 0.12101027549038637
        },
        "Birdie Chances Created": {
          "weight": 0.07653030198477904
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.02254527732239998
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.033489586702205795
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.033489586702205795
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.06697917340441159
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.031191281732446573
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.031191281732446573
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.3531482507913152
        },
        "Great Shots": {
          "weight": 0.253306443146017
        },
        "Poor Shot Avoidance": {
          "weight": 0.1594280109132986
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.024114081400385002
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.03581994615785345
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.03581994615785345
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.033361714558785074
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.0716398923157069
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.033361714558785074
        }
      }
    }
  },
  "TPC_LOUISIANA": {
    "name": "TPC_LOUISIANA",
    "eventId": "18",
    "description": "Zurich Classic template from provided raw metric weights",
    "groupWeights": {
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
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.35
        },
        "Driving Accuracy": {
          "weight": 0.3
        },
        "SG OTT": {
          "weight": 0.35
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.3
        },
        "Approach <100 SG": {
          "weight": 0.4
        },
        "Approach <100 Prox": {
          "weight": 0.3
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.3
        },
        "Approach <150 FW SG": {
          "weight": 0.45
        },
        "Approach <150 FW Prox": {
          "weight": 0.25
        },
        "Approach <150 Rough GIR": {
          "weight": 0.3
        },
        "Approach <150 Rough SG": {
          "weight": 0.45
        },
        "Approach <150 Rough Prox": {
          "weight": 0.25
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.3
        },
        "Approach <200 FW SG": {
          "weight": 0.45
        },
        "Approach <200 FW Prox": {
          "weight": 0.25
        },
        "Approach >150 Rough GIR": {
          "weight": 0.3
        },
        "Approach >150 Rough SG": {
          "weight": 0.45
        },
        "Approach >150 Rough Prox": {
          "weight": 0.25
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.3
        },
        "Approach >200 FW SG": {
          "weight": 0.45
        },
        "Approach >200 FW Prox": {
          "weight": 0.25
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0
        },
        "Scoring Average": {
          "weight": 0.15
        },
        "Birdie Chances Created": {
          "weight": 0.35
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.07
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.1
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.08
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.07
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.1
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.08
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.25
        },
        "Great Shots": {
          "weight": 0.15
        },
        "Poor Shot Avoidance": {
          "weight": 0.2
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.07
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.09
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.06
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.05
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.08
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.05
        }
      }
    }
  },
  "PEBBLE_BEACH_GOLF_LINKS": {
    "name": "PEBBLE_BEACH_GOLF_LINKS",
    "eventId": "5",
    "description": "AT&T Pebble Beach Pro-Am 2026 Pre-Event Blended",
    "groupWeights": {
      "Driving Performance": 0.16979565632636318,
      "Approach - Short (<100)": 0.060628927613061656,
      "Approach - Mid (100-150)": 0.114942076480289,
      "Approach - Long (150-200)": 0.11802776666754901,
      "Approach - Very Long (>200)": 0.03732010926550233,
      "Putting": 0.08367500269909206,
      "Around the Green": 0.03240866058375689,
      "Scoring": 0.224783172097574,
      "Course Management": 0.15841862826681186
    },
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.349460426835393
        },
        "Driving Accuracy": {
          "weight": 0.3572287631836975
        },
        "SG OTT": {
          "weight": 0.2933108099809096
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.4178353867679554
        },
        "Approach <100 SG": {
          "weight": 0.28536269373964906
        },
        "Approach <100 Prox": {
          "weight": 0.29680191949239554
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.19334795552875828
        },
        "Approach <150 FW SG": {
          "weight": 0.18376535678104206
        },
        "Approach <150 FW Prox": {
          "weight": 0.16858985996146897
        },
        "Approach <150 Rough GIR": {
          "weight": 0.18582116288242778
        },
        "Approach <150 Rough SG": {
          "weight": 0.19605132914018408
        },
        "Approach <150 Rough Prox": {
          "weight": -0.07242433570611884
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.2020137384678958
        },
        "Approach <200 FW SG": {
          "weight": 0.18988364755106907
        },
        "Approach <200 FW Prox": {
          "weight": 0.23398408735674564
        },
        "Approach >150 Rough GIR": {
          "weight": 0.17587567592392322
        },
        "Approach >150 Rough SG": {
          "weight": 0.17820857766662507
        },
        "Approach >150 Rough Prox": {
          "weight": -0.02003427303374114
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.14301626762341055
        },
        "Approach >200 FW SG": {
          "weight": 0.26587870208293846
        },
        "Approach >200 FW Prox": {
          "weight": 0.591105030293651
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.40463581049420344
        },
        "Scoring Average": {
          "weight": 0.29062418950579666
        },
        "Birdie Chances Created": {
          "weight": 0.08676000000000002
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.02482489510489511
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.035713006993007
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.035713006993007
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.06271552447552449
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.02950678321678322
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.02950678321678322
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.3242574424474893
        },
        "Great Shots": {
          "weight": 0.15027246098022976
        },
        "Poor Shot Avoidance": {
          "weight": -0.16167869544132316
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.04143078893998919
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.059602187597879185
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.059602187597879185
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.049244490362881886
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.10466725626944637
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.049244490362881886
        }
      }
    }
  },
  "WAIALAE_COUNTRY_CLUB": {
    "name": "WAIALAE_COUNTRY_CLUB",
    "eventId": "6",
    "description": "Sony Open 2026 Optimized: 0.4896 corr, 6.4% Top-20, 7.3% Top-20 Weighted",
    "groupWeights": {
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
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.4439213937297278
        },
        "Driving Accuracy": {
          "weight": 0.10452536855202589
        },
        "SG OTT": {
          "weight": 0.45155323771824624
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.12704935482846694
        },
        "Approach <100 SG": {
          "weight": 0.3439453170521983
        },
        "Approach <100 Prox": {
          "weight": -0.5290053281193348
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.061009317754322216
        },
        "Approach <150 FW SG": {
          "weight": 0.1647364944519474
        },
        "Approach <150 FW Prox": {
          "weight": -0.3032646295934103
        },
        "Approach <150 Rough GIR": {
          "weight": 0.06366492684648313
        },
        "Approach <150 Rough SG": {
          "weight": 0.15126210442130167
        },
        "Approach <150 Rough Prox": {
          "weight": -0.25606252693253534
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.058875045115195625
        },
        "Approach <200 FW SG": {
          "weight": 0.15107854596009665
        },
        "Approach <200 FW Prox": {
          "weight": -0.29321927092225336
        },
        "Approach >150 Rough GIR": {
          "weight": 0.053690945491580384
        },
        "Approach >150 Rough SG": {
          "weight": 0.1428106531715783
        },
        "Approach >150 Rough Prox": {
          "weight": -0.30032553933929573
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.08980228691878112
        },
        "Approach >200 FW SG": {
          "weight": 0.2624094451995176
        },
        "Approach >200 FW Prox": {
          "weight": -0.6477882678817013
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.1947674504535388
        },
        "Scoring Average": {
          "weight": -0.09468975965994297
        },
        "Birdie Chances Created": {
          "weight": 0.09881839144013035
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.16398981034606624
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.14839301873369026
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.14399947925214288
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.05187189593106295
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.0000955570911835887
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.10337463709224189
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.11502369101039253
        },
        "Great Shots": {
          "weight": 0.09022106664922576
        },
        "Poor Shot Avoidance": {
          "weight": -0.07429961681411379
        },
        "Course Management: Approach <100 Prox": {
          "weight": -0.10783374148021413
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": -0.10556394634166712
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": -0.16433815048123793
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": -0.17586640960416564
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": -0.12204491100887761
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": -0.044808466610105416
        }
      }
    }
  },
  "THE_RIVIERA_COUNTRY_CLUB": {
    "name": "THE_RIVIERA_COUNTRY_CLUB",
    "eventId": "7",
    "description": "Genesis Invitational 2026 Optimized: 0.6418 corr, 65.0% Top-20, 72.4% Top-20 Weighted",
    "groupWeights": {
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
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.5121256291951152
        },
        "Driving Accuracy": {
          "weight": 0.09293882047578655
        },
        "SG OTT": {
          "weight": 0.39493555032909816
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.2625572329653397
        },
        "Approach <100 SG": {
          "weight": 0.7372450888294415
        },
        "Approach <100 Prox": {
          "weight": 0.00019767820521883359
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.15936071336747104
        },
        "Approach <150 FW SG": {
          "weight": 0.3593671285754248
        },
        "Approach <150 FW Prox": {
          "weight": 0.00023697051816604892
        },
        "Approach <150 Rough GIR": {
          "weight": 0.15789928742890777
        },
        "Approach <150 Rough SG": {
          "weight": 0.3228989295918644
        },
        "Approach <150 Rough Prox": {
          "weight": 0.00023697051816604892
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.13142478679999592
        },
        "Approach <200 FW SG": {
          "weight": 0.388725559496779
        },
        "Approach <200 FW Prox": {
          "weight": 0.0002563771341928853
        },
        "Approach >150 Rough GIR": {
          "weight": 0.13380444612429132
        },
        "Approach >150 Rough SG": {
          "weight": 0.345532453310548
        },
        "Approach >150 Rough Prox": {
          "weight": -0.0002563771341928853
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.2197010793735438
        },
        "Approach >200 FW SG": {
          "weight": 0.7800361356526654
        },
        "Approach >200 FW Prox": {
          "weight": 0.0002627849737908229
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.23074569266537626
        },
        "Scoring Average": {
          "weight": 0.00010824312848986641
        },
        "Birdie Chances Created": {
          "weight": 0.0933274578156979
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.17643055860134577
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.1695485759178827
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.1537034966494277
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.0614716273448912
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.00010824312848986641
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.11455610474839885
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.3663343336024537
        },
        "Great Shots": {
          "weight": 0.3100090948394791
        },
        "Poor Shot Avoidance": {
          "weight": 0.2471999056539836
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.0003595081816616878
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.0003595081816616878
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.0003595081816616878
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": -0.0003595081816616878
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.0003595081816616878
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.0003595081816616878
        }
      }
    }
  },
  "PETE_DYE_STADIUM_COURSE": {
    "name": "PETE_DYE_STADIUM_COURSE",
    "eventId": "2",
    "description": "American Express 2026 Optimized: 0.8272 corr, 60.0% Top-20, 70.8% Top-20 Weighted",
    "groupWeights": {
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
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.27923808554329926
        },
        "Driving Accuracy": {
          "weight": 0.2936802262057306
        },
        "SG OTT": {
          "weight": 0.4270816882509701
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.1284642840040011
        },
        "Approach <100 SG": {
          "weight": 0.08207670615053442
        },
        "Approach <100 Prox": {
          "weight": -0.7894590098454645
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.1262684554688367
        },
        "Approach <150 FW SG": {
          "weight": 0.19181023674027556
        },
        "Approach <150 FW Prox": {
          "weight": 0.681604078651498
        },
        "Approach <150 Rough GIR": {
          "weight": 0.00010574304646325831
        },
        "Approach <150 Rough SG": {
          "weight": 0.00010574304646325831
        },
        "Approach <150 Rough Prox": {
          "weight": -0.00010574304646325831
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.11720580542183769
        },
        "Approach <200 FW SG": {
          "weight": 0.35405375523227467
        },
        "Approach <200 FW Prox": {
          "weight": 0.5284130271688414
        },
        "Approach >150 Rough GIR": {
          "weight": 0.00010913739234877063
        },
        "Approach >150 Rough SG": {
          "weight": 0.00010913739234877063
        },
        "Approach >150 Rough Prox": {
          "weight": -0.00010913739234877063
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.11296129416014204
        },
        "Approach >200 FW SG": {
          "weight": 0.17517432657899157
        },
        "Approach >200 FW Prox": {
          "weight": -0.7118643792608664
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.7655709758222491
        },
        "Scoring Average": {
          "weight": 0.007996325976291628
        },
        "Birdie Chances Created": {
          "weight": 0.09163537167074406
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.008842514217185474
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.017359903870478935
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.021512179838451863
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.05542564628140196
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.014360125375776923
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.017296956947420127
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.3738648846703404
        },
        "Great Shots": {
          "weight": 0.08278006608084369
        },
        "Poor Shot Avoidance": {
          "weight": 0.20992705977835463
        },
        "Course Management: Approach <100 Prox": {
          "weight": -0.030212644831939545
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.0699386316246899
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": -0.07517216176760337
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": -0.05296510860702875
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.18280075040093738
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": -0.05795170447265951
        }
      }
    }
  },
  "TORREY_PINES_GOLF_COURSE": {
    "name": "TORREY_PINES_GOLF_COURSE",
    "eventId": "4",
    "description": "Farmers 2026 Optimized: 0.8968 corr, 85.0% Top-20, 91.2% Top-20 Weighted",
    "groupWeights": {
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
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.31176799346270223
        },
        "Driving Accuracy": {
          "weight": 0.31964555231972197
        },
        "SG OTT": {
          "weight": 0.3685864542175758
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.6036962474169806
        },
        "Approach <100 SG": {
          "weight": 0.39585520976128485
        },
        "Approach <100 Prox": {
          "weight": 0.0004485428217345848
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.10705782084139466
        },
        "Approach <150 FW SG": {
          "weight": 0.1971588253591168
        },
        "Approach <150 FW Prox": {
          "weight": 0.6954900830682796
        },
        "Approach <150 Rough GIR": {
          "weight": 0.00009867208712271649
        },
        "Approach <150 Rough SG": {
          "weight": 0.00009729932204305113
        },
        "Approach <150 Rough Prox": {
          "weight": -0.00009729932204305113
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.12213861844559162
        },
        "Approach <200 FW SG": {
          "weight": 0.35239036142743935
        },
        "Approach <200 FW Prox": {
          "weight": 0.5251616090847234
        },
        "Approach >150 Rough GIR": {
          "weight": 0.00009842786400276938
        },
        "Approach >150 Rough SG": {
          "weight": 0.00011255531424005993
        },
        "Approach >150 Rough Prox": {
          "weight": -0.00009842786400276938
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.3349991560344384
        },
        "Approach >200 FW SG": {
          "weight": 0.6646593942961323
        },
        "Approach >200 FW Prox": {
          "weight": 0.00034144966942937724
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.7826623799724027
        },
        "Scoring Average": {
          "weight": 0.007818311232344936
        },
        "Birdie Chances Created": {
          "weight": 0.07900675571673915
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.007389830518636098
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.016113217969961735
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.019173022165490886
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.05867670947350347
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.014092796345894009
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.015066976605027012
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.4798787771341577
        },
        "Great Shots": {
          "weight": 0.10726773827572121
        },
        "Poor Shot Avoidance": {
          "weight": 0.10158100809932528
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.00012381627567870942
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.08407240502916724
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": -0.00012381627567870942
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": -0.00012381627567870942
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.21993976277920974
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.00012381627567870942
        }
      }
    }
  },
  "WM_PHOENIX_OPEN_STADIUM_COURSE": {
    "name": "WM_PHOENIX_OPEN_STADIUM_COURSE",
    "eventId": "3",
    "description": "WM Phoenix Open 2026 Pre-Event Blended",
    "groupWeights": {
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
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.2791439082556341
        },
        "Driving Accuracy": {
          "weight": 0.279165053917666
        },
        "SG OTT": {
          "weight": 0.4416910378267
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.4424213578642136
        },
        "Approach <100 SG": {
          "weight": 0.30442275772422756
        },
        "Approach <100 Prox": {
          "weight": 0.25315588441155884
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.14216793107882214
        },
        "Approach <150 FW SG": {
          "weight": 0.1626214049976426
        },
        "Approach <150 FW Prox": {
          "weight": 0.1777874930350178
        },
        "Approach <150 Rough GIR": {
          "weight": 0.13985341391281986
        },
        "Approach <150 Rough SG": {
          "weight": 0.17363679225065362
        },
        "Approach <150 Rough Prox": {
          "weight": 0.2039329647250439
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.1354857142857143
        },
        "Approach <200 FW SG": {
          "weight": 0.15694285714285716
        },
        "Approach <200 FW Prox": {
          "weight": 0.20110000000000003
        },
        "Approach >150 Rough GIR": {
          "weight": 0.12057142857142858
        },
        "Approach >150 Rough SG": {
          "weight": 0.14507142857142857
        },
        "Approach >150 Rough Prox": {
          "weight": 0.24082857142857145
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.15443144314431445
        },
        "Approach >200 FW SG": {
          "weight": 0.265016501650165
        },
        "Approach >200 FW Prox": {
          "weight": 0.5805520552055206
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.5088361433217414
        },
        "Scoring Average": {
          "weight": 0.18642385667825864
        },
        "Birdie Chances Created": {
          "weight": 0.08676000000000002
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.0163485
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.030081240000000002
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.030081240000000002
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.08828190000000001
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.02659356
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.02659356
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.32567601153451076
        },
        "Great Shots": {
          "weight": 0.15977217208123562
        },
        "Poor Shot Avoidance": {
          "weight": 0.16935123721723203
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.025890043437526614
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.04763767992504897
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.04763767992504897
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.042114470658376625
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.1398062345626437
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.042114470658376625
        }
      }
    }
  },
  "PGA_NATIONAL_RESORT_CHAMPION_COURSE": {
    "name": "PGA_NATIONAL_RESORT_CHAMPION_COURSE",
    "eventId": "10",
    "description": "Cognizant Classic 2026 Optimized: 0.8115 corr, 75.0% Top-20, 86.9% Top-20 Weighted",
    "groupWeights": {
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
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.2546693201661473
        },
        "Driving Accuracy": {
          "weight": 0.3141084710185391
        },
        "SG OTT": {
          "weight": 0.43122220881531365
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.48478342010029074
        },
        "Approach <100 SG": {
          "weight": 0.37274890023325546
        },
        "Approach <100 Prox": {
          "weight": 0.14246767966645388
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.21698109323871806
        },
        "Approach <150 FW SG": {
          "weight": 0.22862655302551652
        },
        "Approach <150 FW Prox": {
          "weight": -0.08156809146509487
        },
        "Approach <150 Rough GIR": {
          "weight": 0.19903906749446293
        },
        "Approach <150 Rough SG": {
          "weight": 0.22258991546252752
        },
        "Approach <150 Rough Prox": {
          "weight": 0.05119527931367997
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.23459723275824657
        },
        "Approach <200 FW SG": {
          "weight": 0.25127625548690646
        },
        "Approach <200 FW Prox": {
          "weight": -0.076603970702823
        },
        "Approach >150 Rough GIR": {
          "weight": 0.16345331085501544
        },
        "Approach >150 Rough SG": {
          "weight": 0.22483869300652576
        },
        "Approach >150 Rough Prox": {
          "weight": 0.04923053719048285
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.3351304210719545
        },
        "Approach >200 FW SG": {
          "weight": 0.3424222367613377
        },
        "Approach >200 FW Prox": {
          "weight": -0.3224473421667078
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.46243473880899155
        },
        "Scoring Average": {
          "weight": 0.23952042731697154
        },
        "Birdie Chances Created": {
          "weight": 0.06842390917614805
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.0187758136848655
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.025417071593118186
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.02269323235714167
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.08412058325487454
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.04156885316218043
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.037045370645708564
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.4469271053234971
        },
        "Great Shots": {
          "weight": 0.21494389530715677
        },
        "Poor Shot Avoidance": {
          "weight": 0.17510774960570225
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.026122754506963237
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": -0.028352350116483484
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.03556245158620629
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.050093183646499874
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": -0.13895724110515392
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": -0.05892186579845889
        }
      }
    }
  },
  "BAY_HILL_CLUB_AND_LODGE": {
    "name": "BAY_HILL_CLUB_AND_LODGE",
    "eventId": "9",
    "description": "Arnold Palmer Invitational (Bay Hill) 2026 — TECHNICAL-adjusted",
    "groupWeights": {
      "Driving Performance": 0.18,
      "Approach - Short (<100)": 0.04,
      "Approach - Mid (100-150)": 0.08,
      "Approach - Long (150-200)": 0.12,
      "Approach - Very Long (>200)": 0.1,
      "Putting": 0.09,
      "Around the Green": 0.065,
      "Scoring": 0.23,
      "Course Management": 0.105
    },
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.36
        },
        "Driving Accuracy": {
          "weight": 0.25
        },
        "SG OTT": {
          "weight": 0.39
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.55
        },
        "Approach <100 SG": {
          "weight": 0.3
        },
        "Approach <100 Prox": {
          "weight": 0.15
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.19
        },
        "Approach <150 FW SG": {
          "weight": 0.24
        },
        "Approach <150 FW Prox": {
          "weight": 0.08
        },
        "Approach <150 Rough GIR": {
          "weight": 0.2
        },
        "Approach <150 Rough SG": {
          "weight": 0.21
        },
        "Approach <150 Rough Prox": {
          "weight": 0.08
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.24
        },
        "Approach <200 FW SG": {
          "weight": 0.28
        },
        "Approach <200 FW Prox": {
          "weight": 0.08
        },
        "Approach >150 Rough GIR": {
          "weight": 0.2
        },
        "Approach >150 Rough SG": {
          "weight": 0.17
        },
        "Approach >150 Rough Prox": {
          "weight": 0.03
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.25
        },
        "Approach >200 FW SG": {
          "weight": 0.4
        },
        "Approach >200 FW Prox": {
          "weight": 0.35
        }
      },
      "Putting": {
        "SG Putting": {
          "weight": 1
        }
      },
      "Around the Green": {
        "SG Around Green": {
          "weight": 1
        }
      },
      "Scoring": {
        "SG T2G": {
          "weight": 0.42
        },
        "Scoring Average": {
          "weight": 0.16
        },
        "Birdie Chances Created": {
          "weight": 0.08
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.04
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.06
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.05
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.05
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.08
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.06
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.36
        },
        "Great Shots": {
          "weight": 0.12
        },
        "Poor Shot Avoidance": {
          "weight": 0.3
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.01
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.04
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.08
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.05
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.03
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.01
        }
      }
    }
  }
};

module.exports = { WEIGHT_TEMPLATES };
