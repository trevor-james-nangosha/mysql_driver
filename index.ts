import * as net from "node:net";
import calculateToken from "./auth";

type MySQLSocket = net.Socket

interface ErrorPacket {
  packetLength: number;
  packetNumber: number;
  responseCode: string;
  errorCode: number;
  sqlState: string;
  message: string;
}

interface ServerGreetingPacket{
  packetLength: number;
  packetNumber: number;
  protocolVersion: number;
  serverVersion: string;
  threadId: number;
  seed: string;
  serverCapabilities: string;
  serverLanguage: number;
  serverStatus: number;
  extendedServerCapabilities: string;
  authPluginDataLength: number;
  filler: string;
  remainderSeed: string;
  authPluginName: string;

}

interface ConnectionConfig {
  host: string;
  user: string;
  password: string;
  database: string;
}

interface CommandQuery {
  command: number;
  query: string;
}

interface CommandChangeUser {
  command: number;
  user: string;
  password: string;
  database: string;
}

interface CommandInitDB {
  command: number;
  database: string;
}

interface AuthenticationPacket{
  clientFlags: ClientFlags;
  maxPacketSize: number;
  charsetNumber: number;
  user: string;
  scrambleBuff: Buffer;
  database: string;
}

interface ClientFlags{
  clientCapabilities: number;
  extendedClientCapabilities: number;
}

const createClientFlags = (): ClientFlags => {
  return {
    clientCapabilities: 0xa68d,
    extendedClientCapabilities: 0x19ef,
  }
}

const createAuthenticationPacket = (user: string, password: string, scramble: string, database: string) => {
  let authPacket: AuthenticationPacket = {
    clientFlags: createClientFlags(),
    maxPacketSize: 0x1000000, //??????
    charsetNumber: 0xff,
    user,
    scrambleBuff: calculateToken(password, scramble),
    database,
  }

  let flagBuff = Buffer.alloc(4);
  flagBuff.writeUInt16LE(authPacket.clientFlags.clientCapabilities, 0);
  flagBuff.writeUInt16LE(authPacket.clientFlags.extendedClientCapabilities, 2);

  let maxPacketSizeBuff = Buffer.alloc(4);
  maxPacketSizeBuff.writeUInt32LE(authPacket.maxPacketSize, 0);

  let charsetNumberBuff = Buffer.alloc(1);
  charsetNumberBuff.writeUInt8(authPacket.charsetNumber, 0);

  let userBuff = Buffer.from(authPacket.user, "utf-8");
  let databaseBuff = Buffer.from(authPacket.database, "utf-8");

  let scrambleLengthBuff = Buffer.alloc(1); // length encoding???
  scrambleLengthBuff.writeUint8(authPacket.scrambleBuff.length);

  let packetLength = Buffer.alloc(3);
  let packetNumber = Buffer.alloc(1);
  let filler = Buffer.alloc(23);

  let authPluginBuffer = Buffer.from("caching_sha2_password\0");

  packetNumber.writeUInt8(1, 0);
  packetLength.writeUInt8(32 + userBuff.length + 1 + scrambleLengthBuff.length + authPacket.scrambleBuff.length + databaseBuff.length + 1 + authPluginBuffer.length, 0); // add the 1's for the additional null bytes we are writing into the buffer

  return Buffer.concat([packetLength, packetNumber, flagBuff, maxPacketSizeBuff, charsetNumberBuff, filler, userBuff, Buffer.from([0]), scrambleLengthBuff, authPacket.scrambleBuff, databaseBuff, Buffer.from([0]), authPluginBuffer]);
  // I am getting [Malformed Packet] error. Am I missing some fields?????
}

const createCommandChangeUser = (packet: CommandChangeUser) => {
  let command = Buffer.alloc(1);
  command.writeUInt8(packet.command, 0);

  let user = Buffer.from(packet.user, "utf-8");
  let password = Buffer.from(packet.password, "utf-8");
  let database = Buffer.from(packet.database, "utf-8");

  let packetLength = Buffer.alloc(3);
  let packetNumber = Buffer.alloc(1);
  let payload = Buffer.concat([command, user, Buffer.from([0]), password, Buffer.from([0]), database, Buffer.from([0])])

  packetNumber.writeUInt8(1, 0); // do not split the packet for now since we have a small payload
  packetLength.writeUInt8(payload.length, 0);

  return Buffer.concat([packetLength, packetNumber, payload]);
}

const createCommandQuery = (packet: CommandQuery) => {
  let command = Buffer.alloc(1);
  command.writeUInt8(packet.command, 0);

  let query = Buffer.from(packet.query, "utf-8");

  let packetLength = Buffer.alloc(3);
  let packetNumber = Buffer.alloc(1);
  let payload = Buffer.concat([command, query])

  packetNumber.writeUInt8(1, 0); // do not split the packet for now since we have a small payload
  packetLength.writeUInt8(payload.length, 0);

  // console.log("Buffer: ", Buffer.concat([packetLength, packetNumber, payload]))
  return Buffer.concat([packetLength, packetNumber, payload]);
}

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

const parseServerGreetingPacket = (packet: Buffer): ServerGreetingPacket => {
  let packetLength = packet.subarray(0, 3).readUInt8();
  let packetNumber = packet.subarray(3, 4).readUInt8();
  let protocolVersion = packet.subarray(4, 5).readUInt8();

  let offset = 5;
  let index = packet.indexOf(0x00, offset);
  let serverVersion = packet.subarray(5, index+=1).toString();
  
  let threadId = packet.subarray(index, index+=4).readUInt32LE();
  let seed = packet.subarray(index, index+=9); // this part of the seed also seems to be null-terminated for me
  let serverCapabilities = packet.subarray(index, index+=2).readUInt16LE().toString(16);
  let serverLanguage = packet.subarray(index, index+=1).readUInt8();
  let serverStatus = packet.subarray(index, index+=2).readUint16LE();
  let extendedServerCapabilities = packet.subarray(index, index+= 2).readUInt16LE().toString(16);;
  let authPluginDataLength = packet.subarray(index, index+=1).readUInt8();
  let filler = packet.subarray(index, index += 10);
  let remainderSeed = packet.subarray(index, index+=13);
  let authPluginName = packet.subarray(index).toString();

  return {
    packetLength,
    packetNumber,
    protocolVersion,
    serverVersion,
    threadId,
    seed: seed.toString("utf8").replace("\0", ""),
    serverCapabilities,
    serverLanguage,
    serverStatus,
    extendedServerCapabilities,
    authPluginDataLength,
    filler: filler.toString(),
    remainderSeed: remainderSeed.toString("utf8").replace("\0", ""),
    authPluginName,
  }
}

const parseServerCapabilites = () => {}

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
      const responseCode = data.at(4).toString(16);

      switch (responseCode) {
        case "a":
          let greetingPacket = parseServerGreetingPacket(data)
          let firstSeed = greetingPacket.seed
          let secondSeed = greetingPacket.remainderSeed
          let seed = firstSeed.concat(secondSeed)

          this.sendAuthenticationPacket(seed); 
          break;
        case "ff":
          let errorPacket = parseErrorPacket(data);
          console.log("Message: ", errorPacket.message)
          break
        case "fe":
          console.log("Auth Switch Request")
          break
        default:
          break;
      }
      
      console.log("===========");
    });

    this.client.on("end", () => {
      console.log("disconnected from server");
    });

    this.client.on("error", (err) => {
      console.log("Server error: ", err);
    });
  }

  connect() { return this.client }

  end() { }
  
  sendAuthenticationPacket(seed: string) {
    // let packet = createCommandChangeUser({ command: 0x11, user: this.user, password: this.password, database: this.database });

    let packet = createAuthenticationPacket(this.user, this.password, seed, this.database);
    this.client.write(packet);
  }

  query(sql: string) {
    let packet = createCommandQuery({ command: 0x03, query: sql });
    this.client.write(packet);
  }
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
  host: "127.0.0.1",
  database: "test",
  password: "dora@2009luv8zZ",
  user: "root",
});

conn.connect()
//conn.query("insert into students(1, 'trevor');"); // this is failing which means our login was not successful.

// the biggest issue is with the password encryption in the authenticationPacket



// what is the end goal?
// the end goal is to make a basic sql statement.

// here are some commands in case i  need them
// sudo service mysql start
// sudo service mysql stop

// sniff all connections on port 3306 and write them to a file called mysql.pcap
// tshark -i any -w ~/mysql.pcap tcp port 3306