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
  "PGA_NATIONAL_RESORT_CHAMPION_COURSE": {
    "name": "PGA_NATIONAL_RESORT_CHAMPION_COURSE",
    "eventId": "10",
    "description": "Cognizant Classic 2026 Pre-Event Blended",
    "groupWeights": {
      "Driving Performance": 0.13061830677706968,
      "Approach - Short (<100)": 0.03967325412221145,
      "Approach - Mid (100-150)": 0.09623241998060136,
      "Approach - Long (150-200)": 0.1012518186226964,
      "Approach - Very Long (>200)": 0.05207626091173617,
      "Putting": 0.11215650484656241,
      "Around the Green": 0.048760895885741555,
      "Scoring": 0.20959345461956788,
      "Course Management": 0.20963708423381314
    },
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.2523726894092997
        },
        "Driving Accuracy": {
          "weight": 0.30400961814640753
        },
        "SG OTT": {
          "weight": 0.4436176924442928
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.12888443362451668
        },
        "Approach <100 SG": {
          "weight": 0.09351281684089932
        },
        "Approach <100 Prox": {
          "weight": 0.777602749534584
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.11734028683181223
        },
        "Approach <150 FW SG": {
          "weight": 0.19335071707953058
        },
        "Approach <150 FW Prox": {
          "weight": 0.689308996088657
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
          "weight": 0.10435349747268871
        },
        "Approach <200 FW SG": {
          "weight": 0.32773520300016307
        },
        "Approach <200 FW Prox": {
          "weight": 0.5679112995271481
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
          "weight": 0.09394081728511038
        },
        "Approach >200 FW SG": {
          "weight": 0.15089243776420855
        },
        "Approach >200 FW Prox": {
          "weight": 0.755166744950681
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
          "weight": 0.7450259295033682
        },
        "Scoring Average": {
          "weight": 0.007938939594864166
        },
        "Birdie Chances Created": {
          "weight": 0.11022600134258224
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.009029402550906245
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.01956370552696353
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.01956370552696353
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.05595493398970688
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.01634869098232267
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.01634869098232267
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.32903378444648157
        },
        "Great Shots": {
          "weight": 0.07335495663315027
        },
        "Poor Shot Avoidance": {
          "weight": 0.13561301223439726
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.03049188428127408
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.06606574927609384
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.06606574927609384
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.055208790478973514
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.18895728289456207
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.055208790478973514
        }
      }
    }
  },
  "TECHNICAL": {
    "name": "TECHNICAL",
    "description": "Validation CSV TECHNICAL template (Weight_Templates.csv)",
    "groupWeights": {
      "Driving Performance": 0.1182538451141542,
      "Approach - Short (<100)": 0.09510672272112838,
      "Approach - Mid (100-150)": 0.10962438456674964,
      "Approach - Long (150-200)": 0.10594057989210637,
      "Approach - Very Long (>200)": 0.08211706434563013,
      "Putting": 0.1111404301040274,
      "Around the Green": 0.09323045981862499,
      "Scoring": 0.15511447050189348,
      "Course Management": 0.12947204293568543
    },
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.34078151963714026
        },
        "Driving Accuracy": {
          "weight": 0.2633991734227986
        },
        "SG OTT": {
          "weight": 0.3958193069400612
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.5416733628781372
        },
        "Approach <100 SG": {
          "weight": 0.28150151210364915
        },
        "Approach <100 Prox": {
          "weight": 0.17682512501821368
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.16871286515095002
        },
        "Approach <150 FW SG": {
          "weight": 0.22077980622490406
        },
        "Approach <150 FW Prox": {
          "weight": 0.14178458058301113
        },
        "Approach <150 Rough GIR": {
          "weight": 0.19902719647682282
        },
        "Approach <150 Rough SG": {
          "weight": 0.19959620238158393
        },
        "Approach <150 Rough Prox": {
          "weight": 0.07009934918272813
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.22569603858573556
        },
        "Approach <200 FW SG": {
          "weight": 0.24566860330334503
        },
        "Approach <200 FW Prox": {
          "weight": 0.11175799725210407
        },
        "Approach >150 Rough GIR": {
          "weight": 0.18806052115787514
        },
        "Approach >150 Rough SG": {
          "weight": 0.1786932862755395
        },
        "Approach >150 Rough Prox": {
          "weight": 0.050123553425400806
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.34339903879905065
        },
        "Approach >200 FW SG": {
          "weight": 0.3482619156133355
        },
        "Approach >200 FW Prox": {
          "weight": 0.3083390455876138
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
          "weight": 0.37452908138183866
        },
        "Scoring Average": {
          "weight": 0.1331101026500023
        },
        "Birdie Chances Created": {
          "weight": 0.12755050330796508
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.0605143665735881
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.08019723572413225
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.055685439338385434
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.040988504113112896
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.06591394561968796
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.06151082129128726
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.28946543492968035
        },
        "Great Shots": {
          "weight": 0.17964308000049167
        },
        "Poor Shot Avoidance": {
          "weight": 0.13933344366207795
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.023058600950974895
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.055790608105399736
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.11348339806785195
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.0606210808969459
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.07105990083863312
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.033561534101796735
        },
        "Poor Shots": {
          "weight": 0.0339829184461477
        }
      }
    }
  },
  "BALANCED": {
    "name": "BALANCED",
    "description": "Data-driven weights for balanced courses (Accuracy: 0.35, SG Approach: 0.56)",
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
          "weight": 0.061
        },
        "Driving Accuracy": {
          "weight": 0.41
        },
        "SG OTT": {
          "weight": 0.529
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.12
        },
        "Approach <100 SG": {
          "weight": 0.34
        },
        "Approach <100 Prox": {
          "weight": 0.54
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.1
        },
        "Approach <150 FW SG": {
          "weight": 0.3
        },
        "Approach <150 FW Prox": {
          "weight": 0.6
        },
        "Approach <150 Rough GIR": {
          "weight": 0.1
        },
        "Approach <150 Rough SG": {
          "weight": 0.3
        },
        "Approach <150 Rough Prox": {
          "weight": 0.6
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.09
        },
        "Approach <200 FW SG": {
          "weight": 0.28
        },
        "Approach <200 FW Prox": {
          "weight": 0.63
        },
        "Approach >150 Rough GIR": {
          "weight": 0.09
        },
        "Approach >150 Rough SG": {
          "weight": 0.28
        },
        "Approach >150 Rough Prox": {
          "weight": 0.63
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.09
        },
        "Approach >200 FW SG": {
          "weight": 0.24
        },
        "Approach >200 FW Prox": {
          "weight": 0.67
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
          "weight": 0.19
        },
        "Scoring Average": {
          "weight": 0.11
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
          "weight": 0.07
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.03
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.05
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
          "weight": 0.12
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.12
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.16
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.18
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.11
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.03
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
    "description": "Genesis Invitational 2026 Baseline: 0.7226 corr, 70% Top-20, 71.5% Top-20 Weighted",
    "groupWeights": {
      "Driving Performance": 0.14744678590038066,
      "Approach - Short (<100)": 0.05264805066187853,
      "Approach - Mid (100-150)": 0.09483541442257946,
      "Approach - Long (150-200)": 0.10403666259052179,
      "Approach - Very Long (>200)": 0.05004249732105191,
      "Putting": 0.0996927171767531,
      "Around the Green": 0.06016649994811927,
      "Scoring": 0.25232247849631084,
      "Course Management": 0.13880889348240452
    },
    "metricWeights": {
      "Driving Performance": {
        "Driving Distance": {
          "weight": 0.23774850158347896
        },
        "Driving Accuracy": {
          "weight": 0.29618089216197707
        },
        "SG OTT": {
          "weight": 0.466070606254544
        }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": {
          "weight": 0.4840171572744544
        },
        "Approach <100 SG": {
          "weight": 0.3855832142127107
        },
        "Approach <100 Prox": {
          "weight": 0.13039962851283501
        }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": {
          "weight": 0.18694571413879538
        },
        "Approach <150 FW SG": {
          "weight": 0.255990740572068
        },
        "Approach <150 FW Prox": {
          "weight": 0.07714991528290657
        },
        "Approach <150 Rough GIR": {
          "weight": 0.20527588598862523
        },
        "Approach <150 Rough SG": {
          "weight": 0.2220158287346983
        },
        "Approach <150 Rough Prox": {
          "weight": 0.05262191528290658
        }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": {
          "weight": 0.2093901538085396
        },
        "Approach <200 FW SG": {
          "weight": 0.25871601532860966
        },
        "Approach <200 FW Prox": {
          "weight": 0.07792138083062368
        },
        "Approach >150 Rough GIR": {
          "weight": 0.1869193530669498
        },
        "Approach >150 Rough SG": {
          "weight": 0.21340961118531115
        },
        "Approach >150 Rough Prox": {
          "weight": 0.05364348577996617
        }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": {
          "weight": 0.308572172699767
        },
        "Approach >200 FW SG": {
          "weight": 0.38663378170442647
        },
        "Approach >200 FW Prox": {
          "weight": 0.3047940455958066
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
          "weight": 0.4516635923267435
        },
        "Scoring Average": {
          "weight": 0.22109640767325656
        },
        "Birdie Chances Created": {
          "weight": 0.08094
        },
        "Scoring: Approach <100 SG": {
          "weight": 0.020298090452261306
        },
        "Scoring: Approach <150 FW SG": {
          "weight": 0.02401115577889447
        },
        "Scoring: Approach <150 Rough SG": {
          "weight": 0.02401115577889447
        },
        "Scoring: Approach <200 FW SG": {
          "weight": 0.09604462311557788
        },
        "Scoring: Approach >200 FW SG": {
          "weight": 0.04096748743718592
        },
        "Scoring: Approach >150 Rough SG": {
          "weight": 0.04096748743718592
        }
      },
      "Course Management": {
        "Scrambling": {
          "weight": 0.34325412391957444
        },
        "Great Shots": {
          "weight": 0.1994846747392213
        },
        "Poor Shot Avoidance": {
          "weight": 0.17498859699612176
        },
        "Course Management: Approach <100 Prox": {
          "weight": 0.02326266689075051
        },
        "Course Management: Approach <150 FW Prox": {
          "weight": 0.02751803278539999
        },
        "Course Management: Approach <150 Rough Prox": {
          "weight": 0.02751803278539999
        },
        "Course Management: Approach >150 Rough Prox": {
          "weight": 0.04695087037096596
        },
        "Course Management: Approach <200 FW Prox": {
          "weight": 0.11007213114159996
        },
        "Course Management: Approach >200 FW Prox": {
          "weight": 0.04695087037096596
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
  }
};

module.exports = { WEIGHT_TEMPLATES };
