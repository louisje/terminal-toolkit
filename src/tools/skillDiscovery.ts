/** Compatibility tools for clients without MCP Skills protocol support. */
import { z } from "zod";
import { skillCatalog } from "../skills.js";
import type { ToolDefinition } from "./definitions.js";

export const skillDiscoveryDefinitions: ToolDefinition[] = [
  { name: "searchSkills", description: "Search available Skills by keywords or globbed full name. Use describeSkill({name}) to inspect metadata; read the returned SKILL.md path using read().", annotations: {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}, inputSchema: {type:"object",properties:{query:{type:"string"},name:{type:"string",description:"Glob pattern matching the full unique Skill name"},limit:{type:"integer",minimum:1}},required:[]} },
  { name: "describeSkill", description: "Describe one Skill by its full unique name. Returns metadata and SKILL.md path, not its contents. Read the path using read({path,offset?,limit?}).", annotations: {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}, inputSchema: {type:"object",properties:{name:{type:"string",description:"Full unique Skill name, e.g. mattpocock/engineering/code-review"}},required:["name"]} },
];

const searchSchema = z.object({query:z.string().optional(),name:z.string().optional(),limit:z.number().int().positive().optional()});
const describeSchema = z.object({name:z.string().min(1)});
const glob = (value:string, pattern?:string) => !pattern || new RegExp("^"+pattern.split(/([*?])/).map(part=>part==="*" ? ".*" : part==="?" ? "." : part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("")+"$","i").test(value);
const fullName = (s:{namespace:string;name:string}) => s.namespace.slice("skills/".length)+"/"+s.name;

export async function handleSkillDiscovery(name:string,args:unknown) {
  const catalog = await skillCatalog();
  const entries = catalog.map(s=>({...s,name:fullName(s)}));
  if(name==="searchSkills") {
    const options = searchSchema.parse(args ?? {});
    const words = (options.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const found = entries.filter(s=>glob(s.name,options.name) && words.every(w=>(s.name+" "+s.description).toLowerCase().includes(w)));
    return {content:[{type:"text" as const,text:JSON.stringify({skills:found.slice(0,options.limit),total:found.length})}]};
  }
  if(name==="describeSkill") {
    const {name:target} = describeSchema.parse(args);
    const found = entries.find(s=>s.name===target);
    if(!found) throw new Error("Skill not found: "+target);
    return {content:[{type:"text" as const,text:JSON.stringify(found)}]};
  }
  throw new Error("Unknown tool: "+name);
}
