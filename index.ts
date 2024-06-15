import * as net from "node:net";
import { calculateTokenCaching256, calculateTokenNativePassword } from "./auth";
import EventEmitter = require("node:events");

type MySQLSocket = net.Socket

let AuthPlugins = {
  MYSQL_NATIVE_PASSWORD: "mysql_native_password\0", // remove this null byte????
  CACHING_256_PASSWORD: "caching_256_password"
}

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

interface AuthSwitchRequest{
  packetLength: number;
  packetNumber: number;
  responseCode: string;
  authPlugin: string;
  authMethodData: string;
}

interface AuthSwitchResponse{
  packetLength: number;
  packetNumber: number;
  authMethodData: string
}

interface ClientFlags{
  clientCapabilities: number;
  extendedClientCapabilities: number;
}

const createClientFlags = (): ClientFlags => {
  return {
    clientCapabilities: 0xa68d,
    extendedClientCapabilities: 0x11ef,
  }
}

const createAuthenticationPacket = (user: string, password: string, scramble: string, database: string) => {
  console.log("Creating authentication packet")
  let authPacket: AuthenticationPacket = {
    clientFlags: createClientFlags(),
    maxPacketSize: 0x1000000, //??????
    charsetNumber: 0xff,
    user,
    scrambleBuff: calculateTokenCaching256(password, scramble),
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
  // I want to pass less stuff during queries, so I will
  // unset the client_query_attributes flag in the client capabilities
  let command = Buffer.alloc(1);
  command.writeUInt8(packet.command, 0);

  let query = Buffer.from(packet.query, "utf-8");

  let packetLength = Buffer.alloc(3);
  let packetNumber = Buffer.alloc(1);
  let payload = Buffer.concat([command, query])


  packetNumber.writeUInt8(0, 0); // do not split the packet for now since we have a small payload, set the packet number to 0 since we are entering "COMMAND" mode
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

const parseServerCapabilites = () => { }

const parseAuthSwitchRequest = (packet: Buffer): AuthSwitchRequest => {
  let packetLength = packet.subarray(0, 3).readUInt8();
  let packetNumber = packet.subarray(3, 4).readUInt8();
  let responseCode = packet.subarray(4, 5).toString("hex");

  let index = packet.indexOf(0x00, 5); //offset=5
  let authPlugin = packet.subarray(5, index+=1).toString("utf8"); // get these indexes right
  let authMethodData = packet.subarray(index).toString("utf8");

  return {
    packetLength,
    packetNumber,
    responseCode,
    authPlugin,
    authMethodData,
  }
}

const createAuthSwitchResponse = (request: AuthSwitchRequest, password: string) => {
  switch (request.authPlugin) {
    case AuthPlugins.MYSQL_NATIVE_PASSWORD:
      let hashedPassword = calculateTokenNativePassword(password, request.authMethodData.replace("\0", ""))
      let packetLength = Buffer.alloc(3)
      let packetNumber = Buffer.alloc(1)

      packetLength.writeUInt8(hashedPassword.length)
      packetNumber.writeUInt8(3) // be mindful of the ordering of packets!!!
      return Buffer.concat([packetLength, packetNumber, hashedPassword])
    default:
      break;
  }
}

class MysqlConnection extends EventEmitter {
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
  PHASE = "AUTHENTICATION"

  constructor(host: string, user: string, password: string, database: string) {
    super()
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
          throw new Error(errorPacket.message);
        case "fe":
          let authSwitchRequest = parseAuthSwitchRequest(data)
          let packet = createAuthSwitchResponse(authSwitchRequest, this.password)
          this.sendAuthSwitchResponse(packet)
          break
        default: // OK packet
          if (this.PHASE === "AUTHENTICATION") { // this will be set the first OK packet that we get!
            this.PHASE = "COMMAND" 
            this.emit("ready")
          }
          break;
      }     
    });

    this.client.on("end", () => {
      console.log("disconnected from server");
    });

    this.client.on("error", (err) => {
      this.emit("error");
    });
  }

  // connect() { return this.client } // todo; this method needs to be changed to do exactly what it says it does!

  end() { }
  
  private sendAuthenticationPacket(seed: string) {
    console.log("Sending authentication packet")
    let packet = createAuthenticationPacket(this.user, this.password, seed, this.database);
    this.client.write(packet);
  }

  private sendAuthSwitchResponse(packet: Buffer) {
    this.client.write(packet)
  }

  query(sql: string) {
    if (this.PHASE === "AUTHENTICATION") throw new Error("Could not execute query statement")
    
    let packet = createCommandQuery({ command: 0x03, query: sql });
    this.client.write(packet);
  }
}

const createConnection = async (config: ConnectionConfig): Promise<MysqlConnection> => {
  let conn = new MysqlConnection(
    config.host,
    config.user,
    config.password,
    config.database
  );

  // Approach 1: using events
  return new Promise((resolve, reject) => {
    conn.on("ready", () => {
      resolve(conn);
    });

    conn.on("error", (reason = "Could not establish connection") => {
      reject(reason);
    });
  })
};

module.exports = { createConnection };

// demo usage
// todo: use top-level await, I don't love chaining
createConnection({
  host: "127.0.0.1",
  database: "test",
  password: "dora@2009luv8zZ",
  user: "root",
}).then((conn) => {
  conn.query("insert into students values(2, 'forest');");
}).catch((err) => {
  console.error(err)
})

// what is the end goal?
// the end goal is to make a basic sql statement. ✅
