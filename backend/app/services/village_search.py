"""CSVAT — Village Search Service.

Provides village search with autocomplete from a comprehensive
Indian village database. For production, this could connect to
Census of India data or a persistent database.

Current implementation uses an in-memory database of Indian villages
with coordinates, covering all major states.
"""

from typing import Optional

# ─── Comprehensive Indian Village Database ───
# Covers villages across major states with real coordinates.
# For production: load from Census 2011 CSV / persistent table.

VILLAGE_DB = [
    # Rajasthan
    {"id": "vg-raj-01", "name": "Barna", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Girwa",
     "lat": 24.575, "lon": 73.675, "level": "village"},
    {"id": "vg-raj-02", "name": "Dhelana", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Mavli",
     "lat": 24.74, "lon": 73.84, "level": "village"},
    {"id": "vg-raj-03", "name": "Kumbhalgarh", "state": "Rajasthan", "district": "Rajsamand", "tehsil": "Kelwara",
     "lat": 25.15, "lon": 73.58, "level": "village"},
    {"id": "vg-raj-04", "name": "Ranakpur", "state": "Rajasthan", "district": "Pali", "tehsil": "Desuri",
     "lat": 25.12, "lon": 73.08, "level": "village"},
    {"id": "vg-raj-05", "name": "Jhadol", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Jhadol",
     "lat": 24.35, "lon": 73.60, "level": "village"},
    {"id": "vg-raj-06", "name": "Gogunda", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Gogunda",
     "lat": 24.48, "lon": 73.52, "level": "village"},
    {"id": "vg-raj-07", "name": "Salumber", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Salumber",
     "lat": 24.08, "lon": 73.93, "level": "village"},
    {"id": "vg-raj-08", "name": "Khempur", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Girwa",
     "lat": 24.65, "lon": 73.78, "level": "village"},
    {"id": "vg-raj-09", "name": "Amet", "state": "Rajasthan", "district": "Rajsamand", "tehsil": "Amet",
     "lat": 25.28, "lon": 73.92, "level": "village"},
    {"id": "vg-raj-10", "name": "Nathdwara", "state": "Rajasthan", "district": "Rajsamand", "tehsil": "Nathdwara",
     "lat": 24.94, "lon": 73.82, "level": "village"},
    {"id": "vg-raj-11", "name": "Rishabhdeo", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Rishabhdeo",
     "lat": 24.06, "lon": 73.57, "level": "village"},
    {"id": "vg-raj-12", "name": "Dungarpur", "state": "Rajasthan", "district": "Dungarpur", "tehsil": "Dungarpur",
     "lat": 23.84, "lon": 73.71, "level": "village"},
    {"id": "vg-raj-13", "name": "Banswara", "state": "Rajasthan", "district": "Banswara", "tehsil": "Banswara",
     "lat": 23.55, "lon": 74.44, "level": "village"},
    {"id": "vg-raj-14", "name": "Pratapgarh", "state": "Rajasthan", "district": "Pratapgarh", "tehsil": "Pratapgarh",
     "lat": 24.03, "lon": 74.78, "level": "village"},
    {"id": "vg-raj-15", "name": "Bhilwara", "state": "Rajasthan", "district": "Bhilwara", "tehsil": "Bhilwara",
     "lat": 25.35, "lon": 74.63, "level": "village"},
    {"id": "vg-raj-16", "name": "Chittorgarh", "state": "Rajasthan", "district": "Chittorgarh", "tehsil": "Chittorgarh",
     "lat": 24.88, "lon": 74.63, "level": "village"},
    {"id": "vg-raj-17", "name": "Ajmer", "state": "Rajasthan", "district": "Ajmer", "tehsil": "Ajmer",
     "lat": 26.45, "lon": 74.64, "level": "village"},
    {"id": "vg-raj-18", "name": "Pushkar", "state": "Rajasthan", "district": "Ajmer", "tehsil": "Pushkar",
     "lat": 26.49, "lon": 74.55, "level": "village"},
    {"id": "vg-raj-19", "name": "Sambhar", "state": "Rajasthan", "district": "Jaipur", "tehsil": "Sambhar",
     "lat": 26.91, "lon": 75.19, "level": "village"},
    {"id": "vg-raj-20", "name": "Mandore", "state": "Rajasthan", "district": "Jodhpur", "tehsil": "Jodhpur",
     "lat": 26.31, "lon": 73.01, "level": "village"},

    # Madhya Pradesh
    {"id": "vg-mp-01", "name": "Khajuraho", "state": "Madhya Pradesh", "district": "Chhatarpur", "tehsil": "Rajnagar",
     "lat": 24.85, "lon": 79.92, "level": "village"},
    {"id": "vg-mp-02", "name": "Orchha", "state": "Madhya Pradesh", "district": "Tikamgarh", "tehsil": "Tikamgarh",
     "lat": 25.35, "lon": 78.64, "level": "village"},
    {"id": "vg-mp-03", "name": "Mandla", "state": "Madhya Pradesh", "district": "Mandla", "tehsil": "Mandla",
     "lat": 22.60, "lon": 80.38, "level": "village"},
    {"id": "vg-mp-04", "name": "Pachmarhi", "state": "Madhya Pradesh", "district": "Hoshangabad", "tehsil": "Pachmarhi",
     "lat": 22.47, "lon": 78.43, "level": "village"},
    {"id": "vg-mp-05", "name": "Mandu", "state": "Madhya Pradesh", "district": "Dhar", "tehsil": "Mandu",
     "lat": 22.36, "lon": 75.40, "level": "village"},
    {"id": "vg-mp-06", "name": "Sanchi", "state": "Madhya Pradesh", "district": "Raisen", "tehsil": "Sanchi",
     "lat": 23.48, "lon": 77.74, "level": "village"},
    {"id": "vg-mp-07", "name": "Barwani", "state": "Madhya Pradesh", "district": "Barwani", "tehsil": "Barwani",
     "lat": 22.04, "lon": 74.90, "level": "village"},
    {"id": "vg-mp-08", "name": "Harda", "state": "Madhya Pradesh", "district": "Harda", "tehsil": "Harda",
     "lat": 22.34, "lon": 77.09, "level": "village"},
    {"id": "vg-mp-09", "name": "Betul", "state": "Madhya Pradesh", "district": "Betul", "tehsil": "Betul",
     "lat": 21.91, "lon": 77.90, "level": "village"},
    {"id": "vg-mp-10", "name": "Chhindwara", "state": "Madhya Pradesh", "district": "Chhindwara", "tehsil": "Chhindwara",
     "lat": 22.06, "lon": 78.94, "level": "village"},

    # Maharashtra
    {"id": "vg-mh-01", "name": "Panchgani", "state": "Maharashtra", "district": "Satara", "tehsil": "Mahabaleshwar",
     "lat": 17.93, "lon": 73.80, "level": "village"},
    {"id": "vg-mh-02", "name": "Lonar", "state": "Maharashtra", "district": "Buldhana", "tehsil": "Lonar",
     "lat": 19.98, "lon": 76.51, "level": "village"},
    {"id": "vg-mh-03", "name": "Malshiras", "state": "Maharashtra", "district": "Solapur", "tehsil": "Malshiras",
     "lat": 17.85, "lon": 75.12, "level": "village"},
    {"id": "vg-mh-04", "name": "Phaltan", "state": "Maharashtra", "district": "Satara", "tehsil": "Phaltan",
     "lat": 17.98, "lon": 74.43, "level": "village"},
    {"id": "vg-mh-05", "name": "Jawhar", "state": "Maharashtra", "district": "Palghar", "tehsil": "Jawhar",
     "lat": 19.92, "lon": 73.23, "level": "village"},
    {"id": "vg-mh-06", "name": "Mulshi", "state": "Maharashtra", "district": "Pune", "tehsil": "Mulshi",
     "lat": 18.52, "lon": 73.45, "level": "village"},
    {"id": "vg-mh-07", "name": "Junnar", "state": "Maharashtra", "district": "Pune", "tehsil": "Junnar",
     "lat": 19.21, "lon": 73.87, "level": "village"},
    {"id": "vg-mh-08", "name": "Velhe", "state": "Maharashtra", "district": "Pune", "tehsil": "Velhe",
     "lat": 18.20, "lon": 73.62, "level": "village"},
    {"id": "vg-mh-09", "name": "Sangamner", "state": "Maharashtra", "district": "Ahmednagar", "tehsil": "Sangamner",
     "lat": 19.57, "lon": 74.21, "level": "village"},
    {"id": "vg-mh-10", "name": "Akole", "state": "Maharashtra", "district": "Ahmednagar", "tehsil": "Akole",
     "lat": 19.54, "lon": 73.90, "level": "village"},

    # Karnataka
    {"id": "vg-ka-01", "name": "Hampi", "state": "Karnataka", "district": "Ballari", "tehsil": "Hospet",
     "lat": 15.34, "lon": 76.46, "level": "village"},
    {"id": "vg-ka-02", "name": "Coorg", "state": "Karnataka", "district": "Kodagu", "tehsil": "Madikeri",
     "lat": 12.42, "lon": 75.74, "level": "village"},
    {"id": "vg-ka-03", "name": "Sakleshpur", "state": "Karnataka", "district": "Hassan", "tehsil": "Sakleshpur",
     "lat": 12.95, "lon": 75.78, "level": "village"},
    {"id": "vg-ka-04", "name": "Sirsi", "state": "Karnataka", "district": "Uttara Kannada", "tehsil": "Sirsi",
     "lat": 14.62, "lon": 74.84, "level": "village"},
    {"id": "vg-ka-05", "name": "Bidar", "state": "Karnataka", "district": "Bidar", "tehsil": "Bidar",
     "lat": 17.91, "lon": 77.52, "level": "village"},
    {"id": "vg-ka-06", "name": "Raichur", "state": "Karnataka", "district": "Raichur", "tehsil": "Raichur",
     "lat": 16.21, "lon": 77.36, "level": "village"},
    {"id": "vg-ka-07", "name": "Chikkamagaluru", "state": "Karnataka", "district": "Chikkamagaluru", "tehsil": "Chikkamagaluru",
     "lat": 13.32, "lon": 75.77, "level": "village"},
    {"id": "vg-ka-08", "name": "Dandeli", "state": "Karnataka", "district": "Uttara Kannada", "tehsil": "Dandeli",
     "lat": 15.27, "lon": 74.62, "level": "village"},

    # Tamil Nadu
    {"id": "vg-tn-01", "name": "Chettinad", "state": "Tamil Nadu", "district": "Sivaganga", "tehsil": "Karaikudi",
     "lat": 10.07, "lon": 78.77, "level": "village"},
    {"id": "vg-tn-02", "name": "Kodaikanal", "state": "Tamil Nadu", "district": "Dindigul", "tehsil": "Kodaikanal",
     "lat": 10.24, "lon": 77.49, "level": "village"},
    {"id": "vg-tn-03", "name": "Yelagiri", "state": "Tamil Nadu", "district": "Tirupattur", "tehsil": "Yelagiri",
     "lat": 12.58, "lon": 78.63, "level": "village"},
    {"id": "vg-tn-04", "name": "Valparai", "state": "Tamil Nadu", "district": "Coimbatore", "tehsil": "Valparai",
     "lat": 10.33, "lon": 76.97, "level": "village"},
    {"id": "vg-tn-05", "name": "Pollachi", "state": "Tamil Nadu", "district": "Coimbatore", "tehsil": "Pollachi",
     "lat": 10.66, "lon": 77.01, "level": "village"},
    {"id": "vg-tn-06", "name": "Thanjavur", "state": "Tamil Nadu", "district": "Thanjavur", "tehsil": "Thanjavur",
     "lat": 10.79, "lon": 79.14, "level": "village"},
    {"id": "vg-tn-07", "name": "Kumbakonam", "state": "Tamil Nadu", "district": "Thanjavur", "tehsil": "Kumbakonam",
     "lat": 10.96, "lon": 79.39, "level": "village"},
    {"id": "vg-tn-08", "name": "Rameswaram", "state": "Tamil Nadu", "district": "Ramanathapuram", "tehsil": "Rameswaram",
     "lat": 9.29, "lon": 79.31, "level": "village"},

    # Gujarat
    {"id": "vg-gj-01", "name": "Dholavira", "state": "Gujarat", "district": "Kutch", "tehsil": "Rapar",
     "lat": 23.89, "lon": 70.21, "level": "village"},
    {"id": "vg-gj-02", "name": "Saputara", "state": "Gujarat", "district": "Dang", "tehsil": "Ahwa",
     "lat": 20.58, "lon": 73.75, "level": "village"},
    {"id": "vg-gj-03", "name": "Mandvi", "state": "Gujarat", "district": "Kutch", "tehsil": "Mandvi",
     "lat": 22.83, "lon": 69.35, "level": "village"},
    {"id": "vg-gj-04", "name": "Polo", "state": "Gujarat", "district": "Banaskantha", "tehsil": "Vijapur",
     "lat": 23.55, "lon": 72.75, "level": "village"},
    {"id": "vg-gj-05", "name": "Lothal", "state": "Gujarat", "district": "Ahmedabad", "tehsil": "Dholka",
     "lat": 22.52, "lon": 72.25, "level": "village"},
    {"id": "vg-gj-06", "name": "Gir", "state": "Gujarat", "district": "Junagadh", "tehsil": "Talala",
     "lat": 21.12, "lon": 70.79, "level": "village"},

    # Andhra Pradesh
    {"id": "vg-ap-01", "name": "Lepakshi", "state": "Andhra Pradesh", "district": "Anantapur", "tehsil": "Hindupur",
     "lat": 15.59, "lon": 77.61, "level": "village"},
    {"id": "vg-ap-02", "name": "Gandikota", "state": "Andhra Pradesh", "district": "Kadapa", "tehsil": "Jammalamadugu",
     "lat": 15.25, "lon": 78.32, "level": "village"},
    {"id": "vg-ap-03", "name": "Araku", "state": "Andhra Pradesh", "district": "Visakhapatnam", "tehsil": "Araku Valley",
     "lat": 18.32, "lon": 82.88, "level": "village"},
    {"id": "vg-ap-04", "name": "Horsley Hills", "state": "Andhra Pradesh", "district": "Chittoor", "tehsil": "Madanapalle",
     "lat": 13.66, "lon": 78.40, "level": "village"},
    {"id": "vg-ap-05", "name": "Srisailam", "state": "Andhra Pradesh", "district": "Kurnool", "tehsil": "Srisailam",
     "lat": 15.85, "lon": 78.87, "level": "village"},

    # Telangana
    {"id": "vg-tel-01", "name": "Ramappa", "state": "Telangana", "district": "Mulugu", "tehsil": "Venkatapur",
     "lat": 18.23, "lon": 79.94, "level": "village"},
    {"id": "vg-tel-02", "name": "Nagarjunasagar", "state": "Telangana", "district": "Nalgonda", "tehsil": "Nagarjunasagar",
     "lat": 16.57, "lon": 79.31, "level": "village"},
    {"id": "vg-tel-03", "name": "Medak", "state": "Telangana", "district": "Medak", "tehsil": "Medak",
     "lat": 18.05, "lon": 78.26, "level": "village"},
    {"id": "vg-tel-04", "name": "Adilabad", "state": "Telangana", "district": "Adilabad", "tehsil": "Adilabad",
     "lat": 19.67, "lon": 78.53, "level": "village"},

    # Kerala
    {"id": "vg-ker-01", "name": "Munroe", "state": "Kerala", "district": "Kollam", "tehsil": "Kunnathur",
     "lat": 8.91, "lon": 76.71, "level": "village"},
    {"id": "vg-ker-02", "name": "Wayanad", "state": "Kerala", "district": "Wayanad", "tehsil": "Kalpetta",
     "lat": 11.61, "lon": 76.08, "level": "village"},
    {"id": "vg-ker-03", "name": "Munnar", "state": "Kerala", "district": "Idukki", "tehsil": "Devikulam",
     "lat": 10.09, "lon": 77.06, "level": "village"},
    {"id": "vg-ker-04", "name": "Bekal", "state": "Kerala", "district": "Kasaragod", "tehsil": "Hosdurg",
     "lat": 12.39, "lon": 75.03, "level": "village"},
    {"id": "vg-ker-05", "name": "Mararikulam", "state": "Kerala", "district": "Alappuzha", "tehsil": "Cherthala",
     "lat": 9.59, "lon": 76.29, "level": "village"},

    # Uttarakhand
    {"id": "vg-uk-01", "name": "Mana", "state": "Uttarakhand", "district": "Chamoli", "tehsil": "Joshimath",
     "lat": 30.76, "lon": 79.49, "level": "village"},
    {"id": "vg-uk-02", "name": "Munsiyari", "state": "Uttarakhand", "district": "Pithoragarh", "tehsil": "Munsiyari",
     "lat": 30.07, "lon": 80.24, "level": "village"},
    {"id": "vg-uk-03", "name": "Chopta", "state": "Uttarakhand", "district": "Rudraprayag", "tehsil": "Ukhimath",
     "lat": 30.48, "lon": 79.22, "level": "village"},
    {"id": "vg-uk-04", "name": "Binsar", "state": "Uttarakhand", "district": "Almora", "tehsil": "Almora",
     "lat": 29.67, "lon": 79.72, "level": "village"},
    {"id": "vg-uk-05", "name": "Auli", "state": "Uttarakhand", "district": "Chamoli", "tehsil": "Joshimath",
     "lat": 30.53, "lon": 79.57, "level": "village"},

    # West Bengal
    {"id": "vg-wb-01", "name": "Bishnupur", "state": "West Bengal", "district": "Bankura", "tehsil": "Bishnupur",
     "lat": 23.07, "lon": 87.32, "level": "village"},
    {"id": "vg-wb-02", "name": "Shantiniketan", "state": "West Bengal", "district": "Birbhum", "tehsil": "Bolpur",
     "lat": 23.68, "lon": 87.69, "level": "village"},
    {"id": "vg-wb-03", "name": "Sundarbans", "state": "West Bengal", "district": "South 24 Parganas", "tehsil": "Gosaba",
     "lat": 22.17, "lon": 88.99, "level": "village"},
    {"id": "vg-wb-04", "name": "Murshidabad", "state": "West Bengal", "district": "Murshidabad", "tehsil": "Murshidabad",
     "lat": 24.18, "lon": 88.27, "level": "village"},

    # Odisha
    {"id": "vg-od-01", "name": "Konark", "state": "Odisha", "district": "Puri", "tehsil": "Konark",
     "lat": 19.88, "lon": 86.09, "level": "village"},
    {"id": "vg-od-02", "name": "Chilika", "state": "Odisha", "district": "Puri", "tehsil": "Krushnaprasad",
     "lat": 19.72, "lon": 85.32, "level": "village"},
    {"id": "vg-od-03", "name": "Daringbadi", "state": "Odisha", "district": "Kandhamal", "tehsil": "Daringbadi",
     "lat": 19.99, "lon": 84.13, "level": "village"},
    {"id": "vg-od-04", "name": "Koraput", "state": "Odisha", "district": "Koraput", "tehsil": "Koraput",
     "lat": 18.81, "lon": 82.71, "level": "village"},

    # Jharkhand
    {"id": "vg-jh-01", "name": "Netarhat", "state": "Jharkhand", "district": "Latehar", "tehsil": "Netarhat",
     "lat": 23.47, "lon": 84.27, "level": "village"},
    {"id": "vg-jh-02", "name": "Rajrappa", "state": "Jharkhand", "district": "Ramgarh", "tehsil": "Ramgarh",
     "lat": 23.63, "lon": 85.38, "level": "village"},
    {"id": "vg-jh-03", "name": "Dalma", "state": "Jharkhand", "district": "East Singhbhum", "tehsil": "Jamshedpur",
     "lat": 22.93, "lon": 86.29, "level": "village"},

    # Chhattisgarh
    {"id": "vg-cg-01", "name": "Chitrakote", "state": "Chhattisgarh", "district": "Bastar", "tehsil": "Jagdalpur",
     "lat": 19.21, "lon": 81.70, "level": "village"},
    {"id": "vg-cg-02", "name": "Mainpat", "state": "Chhattisgarh", "district": "Surguja", "tehsil": "Mainpat",
     "lat": 22.79, "lon": 83.21, "level": "village"},
    {"id": "vg-cg-03", "name": "Bhoramdeo", "state": "Chhattisgarh", "district": "Kabirdham", "tehsil": "Kawardha",
     "lat": 22.17, "lon": 81.06, "level": "village"},

    # Himachal Pradesh
    {"id": "vg-hp-01", "name": "Chitkul", "state": "Himachal Pradesh", "district": "Kinnaur", "tehsil": "Sangla",
     "lat": 31.35, "lon": 78.44, "level": "village"},
    {"id": "vg-hp-02", "name": "Kalpa", "state": "Himachal Pradesh", "district": "Kinnaur", "tehsil": "Kalpa",
     "lat": 31.53, "lon": 78.25, "level": "village"},
    {"id": "vg-hp-03", "name": "Tirthan", "state": "Himachal Pradesh", "district": "Kullu", "tehsil": "Banjar",
     "lat": 31.63, "lon": 77.44, "level": "village"},
    {"id": "vg-hp-04", "name": "Bir Billing", "state": "Himachal Pradesh", "district": "Kangra", "tehsil": "Baijnath",
     "lat": 32.04, "lon": 76.72, "level": "village"},
    {"id": "vg-hp-05", "name": "Jibhi", "state": "Himachal Pradesh", "district": "Kullu", "tehsil": "Banjar",
     "lat": 31.62, "lon": 77.34, "level": "village"},

    # Goa
    {"id": "vg-ga-01", "name": "Molem", "state": "Goa", "district": "South Goa", "tehsil": "Sanguem",
     "lat": 15.38, "lon": 74.23, "level": "village"},
    {"id": "vg-ga-02", "name": "Cotigao", "state": "Goa", "district": "South Goa", "tehsil": "Canacona",
     "lat": 14.99, "lon": 74.08, "level": "village"},

    # Assam
    {"id": "vg-as-01", "name": "Majuli", "state": "Assam", "district": "Majuli", "tehsil": "Majuli",
     "lat": 26.95, "lon": 94.17, "level": "village"},
    {"id": "vg-as-02", "name": "Haflong", "state": "Assam", "district": "Dima Hasao", "tehsil": "Haflong",
     "lat": 25.17, "lon": 93.01, "level": "village"},
    {"id": "vg-as-03", "name": "Manas", "state": "Assam", "district": "Baksa", "tehsil": "Tamulpur",
     "lat": 26.66, "lon": 90.95, "level": "village"},

    # Meghalaya
    {"id": "vg-ml-01", "name": "Mawlynnong", "state": "Meghalaya", "district": "East Khasi Hills", "tehsil": "Pynursla",
     "lat": 25.20, "lon": 91.92, "level": "village"},
    {"id": "vg-ml-02", "name": "Nongriat", "state": "Meghalaya", "district": "East Khasi Hills", "tehsil": "Cherrapunji",
     "lat": 25.28, "lon": 91.70, "level": "village"},

    # Nagaland
    {"id": "vg-nl-01", "name": "Khonoma", "state": "Nagaland", "district": "Kohima", "tehsil": "Kohima",
     "lat": 25.62, "lon": 94.03, "level": "village"},
    {"id": "vg-nl-02", "name": "Longwa", "state": "Nagaland", "district": "Mon", "tehsil": "Mon",
     "lat": 26.61, "lon": 95.13, "level": "village"},

    # Sikkim
    {"id": "vg-sk-01", "name": "Yuksom", "state": "Sikkim", "district": "West Sikkim", "tehsil": "Gyalshing",
     "lat": 27.37, "lon": 88.22, "level": "village"},
    {"id": "vg-sk-02", "name": "Zuluk", "state": "Sikkim", "district": "East Sikkim", "tehsil": "Rongli",
     "lat": 27.15, "lon": 88.78, "level": "village"},

    # Punjab
    {"id": "vg-pb-01", "name": "Sultanpur Lodhi", "state": "Punjab", "district": "Kapurthala", "tehsil": "Sultanpur Lodhi",
     "lat": 31.22, "lon": 75.18, "level": "village"},
    {"id": "vg-pb-02", "name": "Anandpur Sahib", "state": "Punjab", "district": "Rupnagar", "tehsil": "Anandpur Sahib",
     "lat": 31.24, "lon": 76.50, "level": "village"},

    # Haryana
    {"id": "vg-hr-01", "name": "Pinjore", "state": "Haryana", "district": "Panchkula", "tehsil": "Kalka",
     "lat": 30.80, "lon": 76.92, "level": "village"},
    {"id": "vg-hr-02", "name": "Sultanpur", "state": "Haryana", "district": "Gurugram", "tehsil": "Gurugram",
     "lat": 28.40, "lon": 76.91, "level": "village"},

    # UP
    {"id": "vg-up-01", "name": "Sarnath", "state": "Uttar Pradesh", "district": "Varanasi", "tehsil": "Varanasi",
     "lat": 25.38, "lon": 83.02, "level": "village"},
    {"id": "vg-up-02", "name": "Chitrakoot", "state": "Uttar Pradesh", "district": "Chitrakoot", "tehsil": "Chitrakoot",
     "lat": 25.17, "lon": 80.85, "level": "village"},
    {"id": "vg-up-03", "name": "Fatehpur Sikri", "state": "Uttar Pradesh", "district": "Agra", "tehsil": "Fatehpur Sikri",
     "lat": 27.09, "lon": 77.66, "level": "village"},
    {"id": "vg-up-04", "name": "Bateshwar", "state": "Uttar Pradesh", "district": "Agra", "tehsil": "Bah",
     "lat": 26.87, "lon": 78.57, "level": "village"},

    # Bihar
    {"id": "vg-br-01", "name": "Rajgir", "state": "Bihar", "district": "Nalanda", "tehsil": "Rajgir",
     "lat": 25.03, "lon": 85.42, "level": "village"},
    {"id": "vg-br-02", "name": "Bodh Gaya", "state": "Bihar", "district": "Gaya", "tehsil": "Bodh Gaya",
     "lat": 24.70, "lon": 84.99, "level": "village"},
    {"id": "vg-br-03", "name": "Vikramshila", "state": "Bihar", "district": "Bhagalpur", "tehsil": "Kahalgaon",
     "lat": 25.33, "lon": 87.28, "level": "village"},
]


def generate_bbox(lat: float, lon: float, size_deg: float = 0.05) -> dict:
    """Generate a GeoJSON Polygon bounding box around a lat/lon point."""
    half = size_deg / 2
    return {
        "type": "Polygon",
        "coordinates": [[
            [lon - half, lat - half],
            [lon + half, lat - half],
            [lon + half, lat + half],
            [lon - half, lat + half],
            [lon - half, lat - half],
        ]]
    }


def search_villages(query: str, limit: int = 15) -> list[dict]:
    """Search villages by name, district, state, or tehsil.

    Returns matching villages sorted by relevance (name match first).
    """
    if not query or len(query) < 2:
        return []

    q = query.lower().strip()
    scored = []

    for v in VILLAGE_DB:
        score = 0
        name_lower = v["name"].lower()

        # Exact match
        if name_lower == q:
            score = 100
        # Starts with
        elif name_lower.startswith(q):
            score = 80
        # Contains in name
        elif q in name_lower:
            score = 60
        # District match
        elif q in v["district"].lower():
            score = 40
        # State match
        elif q in v["state"].lower():
            score = 30
        # Tehsil match
        elif q in v["tehsil"].lower():
            score = 35
        else:
            continue

        scored.append((score, v))

    # Sort by score descending, then name
    scored.sort(key=lambda x: (-x[0], x[1]["name"]))
    return [v for _, v in scored[:limit]]


def get_village_by_id(village_id: str) -> Optional[dict]:
    """Look up a village by its ID."""
    for v in VILLAGE_DB:
        if v["id"] == village_id:
            return v
    return None


def get_village_boundary(village_id: str) -> Optional[dict]:
    """Get a village's bounding box polygon and metadata."""
    village = get_village_by_id(village_id)
    if not village:
        return None
    return {
        **village,
        "geojson": generate_bbox(village["lat"], village["lon"]),
    }
