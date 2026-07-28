import { Kafka } from "kafkajs";

const kafka = new Kafka({
  clientId: "test",
  brokers: ["localhost:9092"],
});

const consumer = kafka.consumer({
  groupId: "test-group",
});

await consumer.connect();

console.log("Connected");

await consumer.subscribe({
  topic: "auction-bids",
  fromBeginning: true,
});

console.log("Subscribed");

await consumer.run({
  eachMessage: async ({ message }) => {
    console.log(message.value.toString());
  },
});