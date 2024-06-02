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

type MySQLSocket = net.Socket

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
  client: MySQLSocket;

  constructor(host: string, user: string, password: string, database: string) {
    this.host = host;
    this.user = user;
    this.password = password;
    this.database = database;
    this.port = 3306;

    this.client = net.createConnection(
      { port: this.port, host: this.host},
      () => {
        console.log("connected to server");
      }
    )

    this.client.on("data", (data: Buffer) => {
      console.log(data.toString());
      console.log("size: ", data.length);
      const errorCode = data.at(4).toString(16);

      if (errorCode === "ff") {
        let errorPacket = parseErrorPacket(data);
        console.log(JSON.stringify(errorPacket))
      }

      console.log("===========");
    });

    this.client.on("end", () => {
      console.log("disconnected from server");
    });

    this.client.on("error", (err) => {
    // for example when we cannot make a connection since the server is down
      console.log("An error has happened.");
    });

    this.client.write("This is the reason")
  }

  connect() { return this.client }

  end() {}

  query(sql: string) { }
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

conn.connect()
// conn.command()

// i seem to be getting an error everytime I write some data
// is there a specfic order that you are supposed to send packets when sending them to mysql?

// i know for sure that we are able to establish a connection
// what about we try sending some packets to the server

// here are some possible issues
// could it be that TCP is coalescing packets. will need wireshark to confirm this
// it could also be that multiple TCP packets result into one data event which could be giving me issues


// maybe i am calling client.write("") before I have registered the data event listener



// what is the end goal?
// the end goal is to make a basic sql statement.

// here are some commands in case i  need them
// sudo service mysql start
// sudo service mysql stop

// sniff all connections on port 3306 and write them to a file called mysql.pcap
// tshark -i any -w ~/mysql.pcap tcp port 3306