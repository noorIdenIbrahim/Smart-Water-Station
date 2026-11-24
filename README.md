# AI-IoT Smart Water Station Management System

A smart water station management system built with ESP32, Firebase Realtime Database, and a web dashboard.

## Features

- Monitor water quality using TDS, pH, turbidity, and dissolved oxygen sensors.
- Monitor the main tank water level and pump states.
- Manage vehicle filling and company water allocations.
- Classify current water quality and provide early warnings using trained machine learning models.
- Calculate additional water required for tomorrow using scheduled bookings, estimated individual demand, and available tank stock.

## Technologies

- **Hardware simulation:** ESP32 and Wokwi
- **Web dashboard:** HTML, CSS, and JavaScript
- **Database:** Firebase Realtime Database
- **Machine learning:** Python and Scikit-learn
- **Website hosting:** Render

## Wokwi Simulation

[Open the simulation on Wokwi](https://wokwi.com/projects/476050247930545153)

## Web Dashboard

[Open the web dashboard](https://smart-water-station-5mg0.onrender.com)

## Notes

Live readings require the simulator to be running and successfully sending data to Firebase. AI results require the Python analysis service to be running.

The machine learning models were trained on synthetic data for academic simulation. Their outputs are not a certification of drinking-water safety.
