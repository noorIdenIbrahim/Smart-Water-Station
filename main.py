import time
import machine
import json
import network
from machine import Pin, ADC
from umqtt.simple import MQTTClient
import urequests

#-----------------------------------------------
# 1) Network Settings and MQTT Topics (Wokwi Wi-Fi & MQTT Setup)

WIFI_SSID = "Wokwi-GUEST"  # Default Wokwi network
WIFI_PASS = ""

MQTT_BROKER    = "broker.hivemq.com"
MQTT_PORT      = 1883
MQTT_TOPIC_PUB = b"water_station/telemetry" # Send data to dashboard
MQTT_TOPIC_SUB = b"water_station/commands"  # Receive commands from dashboard
CLIENT_ID      = "esp32s3_water_system_wokwi"

# Dashboard target volume control variables
target_liters = 0.0          # Requested volume in liters from dashboard
session_liters = 0.0         # Volume pumped in the current session
is_filling_process = False
is_water_healthy = True
vehicle_level = 0.0
# Vehicle filling draws only from the main tank, preserving its 10% reserve.
MAIN_TANK_MIN_LEVEL = 10.0
tank_level = 0.0
main_level_valid = False

# -------------------------------------------------------------------
# 2) MQTT Callback Function to Receive Dashboard Commands

def mqtt_callback(topic, msg):
    global target_liters, session_liters, is_filling_process, is_water_healthy, vehicle_level
    try:
        data = json.loads(msg.decode('utf-8'))
        print("\n>> [MQTT RECEIVED]:", data)
        
        # When receiving a start filling command with a specific target volume
        if data.get("action") == "START":
            requested_liters = float(data.get("target_liters", 0.0))
            
            if not main_level_valid or tank_level <= MAIN_TANK_MIN_LEVEL:
                print("==> [REJECTED] Main tank level unavailable or at/below reserve.")
            elif is_filling_process:
                print("==> [REJECTED] A filling session is already running.")
            elif vehicle_level >= 95.0:
                print("==> [REJECTED] Vehicle Tank is Already Full!  ")
            elif requested_liters <= 0:
                print("==> [REJECTED] Invalid Liters Amount!  ")
            else:
                target_liters = requested_liters
                session_liters = 0.0
                is_filling_process = True
                print(f"==> [COMMAND ACCEPTED] Starting Fill Process for {target_liters:.2f} Liters...")

        # When receiving an emergency stop command from the dashboard
        elif data.get("action") == "STOP":
            is_filling_process = False
            target_liters = 0.0
            print(">> [COMMAND ACCEPTED] Emergency Stop Executed from Dashboard! <<")
            
    except Exception as e:
        print("Error processing MQTT command:", e)

# ---------------------------------------------------------------------------------
# 3) Network and MQTT Broker Connection


def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print("Connecting to Wi-Fi...")
        wlan.connect(WIFI_SSID, WIFI_PASS)
        timeout = 10
        while not wlan.isconnected() and timeout > 0:
            time.sleep(1)
            timeout -= 1
    if wlan.isconnected():
        print("Wi-Fi Connected! IP:", wlan.ifconfig()[0])
    else:
        print("Wi-Fi Connection Failed!")
    return wlan

FIREBASE_URL = "https://ai-iot-smartwatersystem-default-rtdb.firebaseio.com"
FIREBASE_LIVE_URL = "https://ai-iot-smartwatersystem-default-rtdb.firebaseio.com/live_telemetry.json"
FIREBASE_HISTORY_URL = "https://ai-iot-smartwatersystem-default-rtdb.firebaseio.com/history_logs.json"

# ---------------------------------------------------------------
# 1. Hardware Pins Configuration


# Distance sensor for main tank
TRIG_MAIN = 4  
ECHO_MAIN = 5  

# Distance sensor for vehicle tank, flow sensor, and start button
TRIG_VEHICLE = 38  
ECHO_VEHICLE = 37  
FLOW_SENSOR_PIN = 39     # YF-S201 white flow sensor pin
START_FILL_BUTTON = 47   # Blue vehicle filling start button

# Pump 1: Vehicle filling pump and its indicator LEDs
PUMP_VEHICLE_PIN = 36  
VEHICLE_LED_RED = 45        # Red during filling
VEHICLE_LED_GREEN = 48      # Green when full

# Main tank level indicator LEDs (3 LEDs)
GREEN_LED = 16  
YELLOW_LED = 17
RED_LED = 18

# Water quality LEDs, filter & distribution pump
QUALITY_GREEN = 8
QUALITY_RED = 3
PUMP_PIN = 13  

# Pump 2: Well submersible pump pins and its LEDs
PUMP_WELL_PIN = 1     
WELL_LED_GREEN = 2    
WELL_LED_RED = 42      

TANK_HEIGHT = 500.0  # Default tank height (500 cm)

# -------------------------------------------------------------------------
# 2. GPIO Initialization


trig = Pin(TRIG_MAIN, Pin.OUT)
echo = Pin(ECHO_MAIN, Pin.IN)

trig_v = Pin(TRIG_VEHICLE, Pin.OUT)
echo_v = Pin(ECHO_VEHICLE, Pin.IN)

pump = Pin(PUMP_PIN, Pin.OUT)
well_pump = Pin(PUMP_WELL_PIN, Pin.OUT)
pump_vehicle = Pin(PUMP_VEHICLE_PIN, Pin.OUT)

green_led = Pin(GREEN_LED, Pin.OUT)
yellow_led = Pin(YELLOW_LED, Pin.OUT)
red_led = Pin(RED_LED, Pin.OUT)
quality_green = Pin(QUALITY_GREEN, Pin.OUT)
quality_red = Pin(QUALITY_RED, Pin.OUT)
well_led_green = Pin(WELL_LED_GREEN, Pin.OUT)
well_led_red = Pin(WELL_LED_RED, Pin.OUT)
vehicle_led_red = Pin(VEHICLE_LED_RED, Pin.OUT)
vehicle_led_green = Pin(VEHICLE_LED_GREEN, Pin.OUT)

# Initialize flow sensor and button with internal pull-up resistors to prevent floating states
flow_pin = Pin(FLOW_SENSOR_PIN, Pin.IN, Pin.PULL_UP)
start_button = Pin(START_FILL_BUTTON, Pin.IN, Pin.PULL_UP)

# Flow sensor calculation and filling session control variables
pulse_count = 0
total_liters = 0.0

Submersible_Pump = False
Falte_Pump  = False
Track_Water_Pump = False

is_filling_process = False
button_state_old = 1 

def flow_pulse_handler(pin):
    global pulse_count
    if is_filling_process:
        pulse_count += 1

# Attach flow sensor to External Interrupt
flow_pin.irq(trigger=Pin.IRQ_RISING, handler=flow_pulse_handler)

# Configure ADC channels for the four chemical sensors
sensors = {
    'tds': ADC(Pin(9)),
    'ph': ADC(Pin(10)),
    'turb': ADC(Pin(11)),
    'do': ADC(Pin(12))
}
for s in sensors.values():
    s.atten(ADC.ATTN_11DB)

# Force all outputs OFF initially to ensure a clean and stable startup
pump.value(0)
well_pump.value(0) 
pump_vehicle.value(0)
green_led.value(0) 
yellow_led.value(0) 
red_led.value(0)
quality_green.value(0) 
quality_red.value(0)
well_led_green.value(0) 
well_led_red.value(0)
vehicle_led_red.value(0) 
vehicle_led_green.value(0)

print("Smart Integrated Water Station (Full Local Offline System)")

# Connect and subscribe to commands topic
wifi = connect_wifi()
mqtt_client = None

if wifi.isconnected():
    try:
        mqtt_client = MQTTClient(CLIENT_ID, MQTT_BROKER, port=MQTT_PORT)
        mqtt_client.set_callback(mqtt_callback) # Set callback function
        mqtt_client.connect()
        mqtt_client.subscribe(MQTT_TOPIC_SUB)  # Subscribe to commands topic
        print("Connected to MQTT Broker & Subscribed to Commands Topic!")
    except Exception as e:
        print("MQTT Setup Error:", e)


# -----------------------------------------------------------
# 3. Ultrasonic Distance Measurement Function

def get_distance(trig_pin, echo_pin):
    trig_pin.value(0)
    time.sleep_us(2)
    trig_pin.value(1)
    time.sleep_us(10)
    trig_pin.value(0)
    duration = machine.time_pulse_us(echo_pin, 1, 30000)
    if duration <= 0: return -1
    return (duration * 0.0343) / 2


last_loop_time = time.ticks_ms()
last_telemetry_time = time.ticks_ms()


# --------------------------------------------------------------
# 4. Main Loop & Decision Making


while True:
    current_time = time.ticks_ms()
    # 1. Listen for incoming MQTT messages/commands from dashboard (Non-blocking)
    if wifi.isconnected() and mqtt_client:
        try:
            mqtt_client.check_msg()
        except Exception as e:
            pass

    # A) Calculate water volume passing through YF-S201 flow sensor
    # Snapshot and reset without losing pulses between the two operations.
    irq_state = machine.disable_irq()
    pulses = pulse_count
    pulse_count = 0
    machine.enable_irq(irq_state)
    liters_this_turn = pulses / 450.0
    total_liters += liters_this_turn
    session_liters += liters_this_turn 
    
    # B) Live measurement of main tank and vehicle tank levels using ultrasonic sensors
    dist_main = get_distance(trig, echo)
    dist_veh = get_distance(trig_v, echo_v)
    
    tank_level = 0.0

    main_level_valid = dist_main >= 0
    if main_level_valid:
        dist_main = min(max(dist_main, 0), TANK_HEIGHT)
        tank_level = round(((TANK_HEIGHT - dist_main) / TANK_HEIGHT) * 100, 2)

    vehicle_level = 0.0
    if dist_veh >= 0:
        dist_veh = min(max(dist_veh, 0), TANK_HEIGHT)
        vehicle_level = round(((TANK_HEIGHT - dist_veh) / TANK_HEIGHT) * 100, 2)

    # C) Water quality sensor readings
    tds_ppm = int((sensors['tds'].read() / 4095) * 1000)        
    ph_val = round((sensors['ph'].read() / 4095) * 14.0, 2)     
    turb_ntu = round((sensors['turb'].read() / 4095) * 5.0, 2)  
    do_mgL = round((sensors['do'].read() / 4095) * 10.0, 2)     

    print("\n--- WATER SYSTEM HEALTH & LEVEL REPORT ---")
    print(f"1. Quality -> TDS: {tds_ppm} PPM | pH: {ph_val} | Turbidity: {turb_ntu} NTU | DO: {do_mgL} mg/L")
    print(f"2. Levels  -> Main Tank: {tank_level:.1f}% | Vehicle Tank: {vehicle_level:.1f}%")
    print(f"3. Metrics -> Consumed Water in Pipe (YF-S201): {total_liters:.1f} Liters")

    # Check safety threshold parameters for water health
    is_tds_safe = tds_ppm <= 300
    is_ph_safe = 6.5 <= ph_val <= 8.5
    is_turb_safe = turb_ntu <= 1.5  
    is_do_safe = do_mgL >= 5.0      
    is_water_healthy = is_tds_safe and is_ph_safe and is_turb_safe and is_do_safe
    Falte_Pump  = is_water_healthy
    # D) Digital input check for start filling button (Edge Detection)
    button_now = start_button.value()
    if button_now == 0 and button_state_old == 1: 
        if main_level_valid and tank_level > MAIN_TANK_MIN_LEVEL and vehicle_level < 95.0 and not is_filling_process:
            is_filling_process = True
            session_liters = 0.0
            target_liters = 0.0 # Continuous filling until full
            print("==> [COMMAND ACCEPTED] Start Button Pressed!")
    button_state_old = button_now

    # Reset all status LEDs to update them live and prevent status overlap
    quality_green.value(0) 
    quality_red.value(0)
    well_led_green.value(0) 
    well_led_red.value(0)
    green_led.value(0) 
    yellow_led.value(0) 
    red_led.value(0)
    vehicle_led_red.value(0) 
    vehicle_led_green.value(0)


    # E) Update main tank level status LEDs
    if tank_level > 95.0: 
        green_led.value(1)
        Submersible_Pump = False
        Falte_Pump  = False

    elif   tank_level <= 95.0 and  tank_level >= 20.0: 
        yellow_led.value(1)
        Submersible_Pump = True
        Falte_Pump  = True

    else: 
        red_led.value(1)
        Submersible_Pump = True
        Falte_Pump  = True  




    # F) System Logic & Safety Control Decision Engine


    if not is_water_healthy:
        # Inlet quality controls only the filter and well pump, independently of vehicle filling.
        pump.value(0) 
        well_pump.value(0) 
        quality_red.value(1) 
        well_led_red.value(1) 
        Submersible_Pump = False
        Falte_Pump  = False
        print("==> INLET QUALITY UNSAFE: Filter and Well Pump Stopped; Vehicle Uses Main Tank.")
        
    elif tank_level >= 95.0:
        # [STANDBY] Main Tank Full (>=95%): Stop well pump automatically to prevent overflow
        pump.value(0)
        well_pump.value(0) 
        quality_red.value(1) 
        well_led_red.value(1)
       
        Submersible_Pump = False
        Falte_Pump  = False
        print("==> SYSTEM STANDBY: Main Tank is Full (>=95%). Well Pump Stopped. ")
    else:
        # [NORMAL OPERATION] Main tank needs water & water is healthy: Well pump runs and filter operates
        pump.value(1)        
        well_pump.value(1)   
        well_led_green.value(1)
        quality_green.value(1)
        Submersible_Pump = True
        Falte_Pump  = True

        print("==> WATER STATUS: SAFE. Well Submersible Pump [RUNNING] & Filling Main Tank... ")






    # G) Vehicle filling pump control and dual indicator LEDs (Red/Green) based on fill process & ultrasonic readings
    if is_filling_process:
        # Stop withdrawal at the tank reserve or on a missing main-tank measurement.
        if not main_level_valid or tank_level <= MAIN_TANK_MIN_LEVEL:
            pump_vehicle.value(0)
            vehicle_led_red.value(1)
            vehicle_led_green.value(0)
            Track_Water_Pump = False
            is_filling_process = False
            print("==> [STOPPED] Main tank level unavailable or reserve reached.")
        elif vehicle_level >= 95.0 or (target_liters > 0 and session_liters >= target_liters):
            pump_vehicle.value(0)        # Turn off vehicle pump immediately when full
            vehicle_led_green.value(1)   # Turn on Green LED to signal completion
            vehicle_led_red.value(0)     
            Track_Water_Pump = False
            is_filling_process = False   
            print("==> [SUCCESS] Vehicle Tank is FULL! Pump Stopped. [GREEN LED ON]")
        else:
            pump_vehicle.value(1)        # Turn on pump and Red LED during filling process
            vehicle_led_red.value(1)     
            vehicle_led_green.value(0)
            Track_Water_Pump = True
            print("==> VEHICLE STATUS: Pumping Water into Vehicle... [RED LED ON]")
    else:
        pump_vehicle.value(0)
        Track_Water_Pump = False
        if vehicle_level >= 95.0: 
            vehicle_led_red.value(0) 
            Track_Water_Pump = False    
            vehicle_led_green.value(1)   # Keep Green LED on if vehicle tank is full
        else:
            vehicle_led_green.value(0)
            





    # One snapshot and one live/history upload pair every 5000 ms.
    current_time = time.ticks_ms()
    if time.ticks_diff(current_time, last_telemetry_time) >= 5000:
        last_telemetry_time = current_time
        telemetry_payload = {
            # Firebase server receipt time in Unix milliseconds.
            "timestamp": {".sv": "timestamp"},
            "timestamp_unit": "unix_ms",
            "tds": tds_ppm,
            "ph": ph_val,
            "turbidity": turb_ntu,
            "dissolved_oxygen": do_mgL,
            "main_tank_level": tank_level,
            "main_level_valid": main_level_valid,
            "vehicle_tank_level": vehicle_level,
            "total_consumed_liters": round(total_liters, 4),
            "session_filled_liters": round(session_liters, 4),
            "target_liters": target_liters,
            "is_filling": is_filling_process,
            "is_run_Submersible_Pump": bool(well_pump.value()),
            "is_run_Falte_Pump": bool(pump.value()),
            "is_run_Track_Water_Pump": bool(pump_vehicle.value()),
            "water_healthy": is_water_healthy
        }
        if wifi.isconnected():
            response = None
            try:
                response = urequests.put(
                    FIREBASE_LIVE_URL, json=telemetry_payload
                )
                if 200 <= response.status_code < 300:
                    print("Live data updated")
                else:
                    print("Live HTTP error:", response.status_code)
            except Exception as exc:
                print("Failed Live PUT:", exc)
            finally:
                if response is not None:
                    response.close()

            response = None
            try:
                response = urequests.post(
                    FIREBASE_HISTORY_URL, json=telemetry_payload
                )
                if 200 <= response.status_code < 300:
                    print("History record saved")
                else:
                    print("History HTTP error:", response.status_code)
            except Exception as exc:
                print("Failed History POST:", exc)
            finally:
                if response is not None:
                    response.close()
        else:
            print("Wi-Fi disconnected: reading not uploaded")

    # HTTP calls remain synchronous and can delay button polling.
    time.sleep_ms(1000)
