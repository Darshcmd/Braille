#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

Adafruit_MPU6050 mpu;

int t1 = D1;
int t2 = D2;
int t3 = D5;
int t4 = D6;
int t5 = D7;

void setup() {
  Serial.begin(115200);

  pinMode(t1, INPUT);
  pinMode(t2, INPUT);
  pinMode(t3, INPUT);
  pinMode(t4, INPUT);
  pinMode(t5, INPUT);

  Wire.begin(D3, D4);

  if (!mpu.begin()) {
    Serial.println("MPU6050 NOT FOUND!");
    while (1);
  }

  Serial.println("MPU6050 FOUND!");
  Serial.println("Glove sensor test started");
}

void loop() {

  Serial.print("Fingers: ");

  Serial.print(digitalRead(t1));
  Serial.print(" ");

  Serial.print(digitalRead(t2));
  Serial.print(" ");

  Serial.print(digitalRead(t3));
  Serial.print(" ");

  Serial.print(digitalRead(t4));
  Serial.print(" ");

  Serial.print(digitalRead(t5));

  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  Serial.print(" | ACC: ");
  Serial.print(a.acceleration.x);
  Serial.print(", ");
  Serial.print(a.acceleration.y);
  Serial.print(", ");
  Serial.print(a.acceleration.z);

  Serial.print(" | GYRO: ");
  Serial.print(g.gyro.x);
  Serial.print(", ");
  Serial.print(g.gyro.y);
  Serial.print(", ");
  Serial.println(g.gyro.z);

  delay(500);
}