use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, Event};
use quick_xml::Writer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;

// Mirror the frontend State
#[derive(Debug, Serialize, Deserialize)]
pub struct SceneState {
    pub nodes: HashMap<String, SceneNode>,
    pub rootId: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SceneNode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub properties: NodeProperties,
    pub children: Vec<String>, // IDs of children
    pub parentId: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NodeProperties {
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub size: [f32; 3],
    pub color: String,
    pub anchored: bool,
    pub transparency: f32,
    pub shape: Option<String>,
    pub meshPath: Option<String>,
    pub source: Option<String>,
}

pub fn generate_rbxlx(state: &SceneState) -> Result<String, String> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    
    // Write XML declaration
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("utf-8"), None)))
        .map_err(|e| e.to_string())?;

    // Root <roblox> element
    let mut roblox_start = BytesStart::new("roblox");
    roblox_start.push_attribute(("version", "4"));
    writer.write_event(Event::Start(roblox_start)).map_err(|e| e.to_string())?;

    // Find root node
    if let Some(root) = state.nodes.get(&state.rootId) {
         write_item(&mut writer, root, &state.nodes).map_err(|e| e.to_string())?;
    }

    writer.write_event(Event::End(BytesEnd::new("roblox"))).map_err(|e| e.to_string())?;

    let result = writer.into_inner().into_inner();
    String::from_utf8(result).map_err(|e| e.to_string())
}

fn write_item<W: std::io::Write>(
    writer: &mut Writer<W>, 
    node: &SceneNode, 
    nodes: &HashMap<String, SceneNode>
) -> quick_xml::Result<()> {
    // Map our generic types to Roblox ClassNames
    let class_name = match node.type_name.as_str() {
        "Part" => "Part",
        "Folder" => "Folder",
        "Script" => "Script",
        "Model" => "Model",
        "MeshPart" => "MeshPart",
        _ => "Folder", // Fallback
    };
    
    let mut item_start = BytesStart::new("Item");
    item_start.push_attribute(("class", class_name));
    item_start.push_attribute(("referent", format!("RBX{}", node.id.replace("-", "")).as_str()));

    writer.write_event(Event::Start(item_start))?;

    // <Properties>
    writer.write_event(Event::Start(BytesStart::new("Properties")))?;

    // Name
    write_string_prop(writer, "Name", &node.name)?;

    if class_name == "Part" || class_name == "MeshPart" {
        write_bool_prop(writer, "Anchored", node.properties.anchored)?;
        write_float_prop(writer, "Transparency", node.properties.transparency)?;
        
        if class_name == "MeshPart" {
             if let Some(path) = &node.properties.meshPath {
                 write_string_prop(writer, "MeshId", &format!("rbxassetid://placeholder_for_{}", path))?;
             }
        } else {
            // Shape for Part
            let shape_val = match node.properties.shape.as_deref() {
                Some("Sphere") => 0,
                Some("Cylinder") => 2,
                _ => 1, // Block default
            };
            write_token_prop(writer, "Shape", shape_val)?;
        }
    } else if class_name == "Script" {
        if let Some(source) = &node.properties.source {
             write_protected_string_prop(writer, "Source", source)?;
        }
    }

    writer.write_event(Event::End(BytesEnd::new("Properties")))?;

    // Write Children
    for child_id in &node.children {
        if let Some(child) = nodes.get(child_id) {
            write_item(writer, child, nodes)?;
        }
    }

    writer.write_event(Event::End(BytesEnd::new("Item")))?;
    Ok(())
}

fn write_string_prop<W: std::io::Write>(writer: &mut Writer<W>, name: &str, value: &str) -> quick_xml::Result<()> {
    let mut start = BytesStart::new("string");
    start.push_attribute(("name", name));
    writer.write_event(Event::Start(start))?;
    writer.write_event(Event::Text(quick_xml::events::BytesText::new(value)))?;
    writer.write_event(Event::End(BytesEnd::new("string")))?;
    Ok(())
}

fn write_bool_prop<W: std::io::Write>(writer: &mut Writer<W>, name: &str, value: bool) -> quick_xml::Result<()> {
    let mut start = BytesStart::new("bool");
    start.push_attribute(("name", name));
    writer.write_event(Event::Start(start))?;
    writer.write_event(Event::Text(quick_xml::events::BytesText::new(if value { "true" } else { "false" })))?;
    writer.write_event(Event::End(BytesEnd::new("bool")))?;
    Ok(())
}

fn write_float_prop<W: std::io::Write>(writer: &mut Writer<W>, name: &str, value: f32) -> quick_xml::Result<()> {
    let mut start = BytesStart::new("float");
    start.push_attribute(("name", name));
    writer.write_event(Event::Start(start))?;
    writer.write_event(Event::Text(quick_xml::events::BytesText::new(&value.to_string())))?;
    writer.write_event(Event::End(BytesEnd::new("float")))?;
    Ok(())
}

fn write_token_prop<W: std::io::Write>(writer: &mut Writer<W>, name: &str, value: i32) -> quick_xml::Result<()> {
    let mut start = BytesStart::new("token");
    start.push_attribute(("name", name));
    writer.write_event(Event::Start(start))?;
    writer.write_event(Event::Text(quick_xml::events::BytesText::new(&value.to_string())))?;
    writer.write_event(Event::End(BytesEnd::new("token")))?;
    Ok(())
}

fn write_protected_string_prop<W: std::io::Write>(writer: &mut Writer<W>, name: &str, value: &str) -> quick_xml::Result<()> {
    let mut start = BytesStart::new("ProtectedString");
    start.push_attribute(("name", name));
    writer.write_event(Event::Start(start))?;
    writer.write_event(Event::CData(quick_xml::events::BytesCData::new(value)))?;
    writer.write_event(Event::End(BytesEnd::new("ProtectedString")))?;
    Ok(())
}
