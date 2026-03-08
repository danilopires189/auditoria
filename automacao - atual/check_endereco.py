import pandas as pd

# Ler o arquivo Excel
df = pd.read_excel('data/BD_END.xlsx', sheet_name='DB_END')

# Filtrar pelo endereço específico
endereco_problema = 'AL2.006.003.004'
registros = df[df['endereco'] == endereco_problema]

print(f"=== ANÁLISE DO ENDEREÇO {endereco_problema} ===")
print(f"Total de registros no Excel: {len(registros)}")
print()

if len(registros) > 0:
    print("Registros encontrados:")
    print(registros[['cd', 'coddv', 'descricao', 'endereco', 'tipo']].to_string(index=False))
    print()
    
    # Verificar se há duplicatas
    duplicatas = registros.duplicated(subset=['cd', 'coddv', 'endereco', 'tipo'], keep=False)
    if duplicatas.any():
        print("⚠️  DUPLICATAS ENCONTRADAS no Excel:")
        print(registros[duplicatas])
    else:
        print("✅ Não há duplicatas no Excel - dados estão corretos")
        print("📝 Isso significa que realmente 2 produtos diferentes estão no mesmo endereço")

# Verificar quantos endereços têm múltiplos produtos
enderecos_multiplos = df.groupby('endereco')['coddv'].count()
enderecos_com_multiplos = enderecos_multiplos[enderecos_multiplos > 1]

print(f"\n=== ESTATÍSTICAS GERAIS ===")
print(f"Total de endereços únicos: {df['endereco'].nunique()}")
print(f"Endereços com múltiplos produtos: {len(enderecos_com_multiplos)}")
print(f"Maior quantidade de produtos em um endereço: {enderecos_multiplos.max()}")