import * as net from "node:net";

interface ErrorPacket {
  packetLength: number;
  packetNumber: number;
  responseCode: string;
  errorCode: number;
  sqlState: string;
  message: string;
}

interface ConnectionConfig {
  host: string;
  user: string;
  password: string;
  database: string;
}

interface ClientCapabilities {}

const parseErrorPacket = (packet: Buffer): ErrorPacket => {
  let packetLength = packet.subarray(0, 3).readUInt8();
  let packetNumber = packet.subarray(3, 4).readUInt8();
  let responseCode = packet.subarray(4, 5).toString("hex");
  let errorCode = packet.subarray(5, 7).readUInt16LE();
  let sqlState = packet.subarray(8, 13).toString();
  let message = packet.subarray(13).toString();

  return {
    packetLength,
    packetNumber,
    responseCode,
    errorCode,
    sqlState,
    message,
  };
};

class MysqlConnection {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  enableCompression = false;
  enableSSL = false;
  enableTLS = false;
  body: any[] = [];
  packetType: string;

  constructor(host: string, user: string, password: string, database: string) {
    this.host = host;
    this.user = user;
    this.password = password;
    this.database = database;
    this.port = 3306;
    this.packetType = "Ok";
  }

  connect() {
    const client = net.createConnection(
      { port: this.port, host: this.host },
      () => {
        console.log("connected to server");
      }
    );

    client.on("data", (data: Buffer) => {
      console.log(data);
      const errorCode = data.at(4).toString(16);

      if (errorCode === "ff") {
        let errorPacket = parseErrorPacket(data);
        console.log(JSON.stringify(errorPacket))
      }

      console.log("===========");
    });

    client.on("end", () => {
      console.log("disconnected from server");
    });

    client.on("error", (err) => {
      console.log("An error has happened.");
    });

    // client.write("Write something")
  }

  end() {}

  query(sql: string) {}
}

const createConnection = (config: ConnectionConfig) => {
  return new MysqlConnection(
    config.host,
    config.user,
    config.password,
    config.database
  );
};

module.exports = { createConnection };

// demo usage
const conn = createConnection({
  host: "localhost",
  database: "test",
  password: "dora@2009luv8zZ",
  user: "root",
});

conn.connect();
